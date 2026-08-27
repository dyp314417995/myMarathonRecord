// pages/tools/ledger/index.js - 跑步账本（列表/筛选/汇总）
// 类型筛选：全部/支出/收入；支出可按大类多选、点击大类展开小类（小类可多选）
const ledger = require('../../../utils/ledger');

Page({
  data: {
    loading: true,
    period: 'month',        // month | year | range
    month: '',
    year: '',
    startDate: '',
    endDate: '',
    typeFilter: 'expense',  // expense(默认) | income，互斥
    // 多选筛选（仅支出）
    selectedBigs: [],                 // ['daily','race']
    expanded: { daily: false, race: false },   // 展开的小类
    selectedSmalls: { daily: [], race: [] },   // 每个大类下已选小类
    // WXML 不支持 indexOf，用预计算映射控制选中样式
    bigSel: { daily: false, race: false },                 // 大类选中态
    smallSel: { daily: {}, race: {} },                     // 小类选中态 { 大类: { 小类: true } }
    smallCatsByBig: { daily: [], race: [] },               // 每个大类可用小类（含自定义）
    stats: { total: 0, expenseSum: 0, dailySum: 0, raceSum: 0, incomeSum: 0, expenseText: '0.00', dailyText: '0.00', raceText: '0.00', incomeText: '0.00' },
    groups: [],
    hasMore: false,
    page: 1,
    pageSize: 20,
  },

  onLoad() {
    const now = new Date();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    this.setData({
      month: `${now.getFullYear()}-${m}`,
      year: String(now.getFullYear()),
    });
  },

  onShow() {
    this.load(true);
  },

  async load(reset) {
    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo) {
      wx.navigateTo({ url: '/pages/login/login' });
      return;
    }
    const page = reset ? 1 : this.data.page;
    const params = { page, pageSize: this.data.pageSize };
    const { period, month, year, startDate, endDate, typeFilter, selectedBigs, selectedSmalls } = this.data;
    if (period === 'month' && month) {
      params.startDate = `${month}-01`;
      params.endDate = `${month}-31`;
    } else if (period === 'year' && year) {
      params.startDate = `${year}-01-01`;
      params.endDate = `${year}-12-31`;
    } else if (period === 'range') {
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;
    }
    params.entryType = typeFilter;
    if (typeFilter === 'expense' && selectedBigs.length) params.bigs = selectedBigs;
    if (typeFilter === 'expense') {
      const smalls = {};
      selectedBigs.forEach(b => {
        if ((selectedSmalls[b] || []).length) smalls[b] = selectedSmalls[b];
      });
      if (Object.keys(smalls).length) params.smalls = smalls;
    }

    const res = await ledger.call('list', params);
    if (!res.ok) {
      this.setData({ loading: false });
      console.warn('ledger list failed:', res.msg, res.errMsg || '');
      wx.showToast({ title: res.msg || '加载失败', icon: 'none' });
      return;
    }
    const prev = [];
    this.data.groups.forEach(g => prev.push(...g.items));
    const list = reset ? res.list : [...prev, ...res.list];
    const fmt = it => {
      const isIncome = it.entryType === 'income';
      return {
        ...it,
        _signedAmount: (isIncome ? '+' : '-') + '¥' + (it.amount || 0).toFixed(2),
        _amount: (it.amount || 0).toFixed(2),
        _images: it._imageUrls || [],
        _catLabel: isIncome ? (it.incomeType || '收入') : it.smallCategory,
        _bigLabel: isIncome ? '收入' : ledger.labelOf(it.bigCategory),
        _bigCls: isIncome ? 'income' : it.bigCategory,
      };
    };
    this.setData({
      groups: this.groupByDate(list.map(fmt)),
      stats: {
        total: res.total,
        expenseSum: res.expenseSum,
        dailySum: res.dailySum,
        raceSum: res.raceSum,
        incomeSum: res.incomeSum,
        expenseText: (res.expenseSum || 0).toFixed(2),
        dailyText: (res.dailySum || 0).toFixed(2),
        raceText: (res.raceSum || 0).toFixed(2),
        incomeText: (res.incomeSum || 0).toFixed(2),
      },
      smallCatsByBig: res.smallCatsByBig || { daily: [], race: [] },
      hasMore: res.hasMore,
      page,
      loading: false,
    });
  },

  groupByDate(list) {
    const map = {};
    list.forEach(it => {
      const d = it.date || '';
      if (!map[d]) map[d] = { date: d, items: [], sum: 0 };
      map[d].items.push(it);
      // 收入记正、支出记负，当日小计 = 收支净额
      map[d].sum += it.entryType === 'income' ? (it.amount || 0) : -(it.amount || 0);
    });
    return Object.keys(map)
      .sort((a, b) => b.localeCompare(a))
      .map(d => {
        const s = Math.round(map[d].sum * 100) / 100;
        return {
          date: d,
          sumText: (s >= 0 ? '+' : '-') + '¥' + Math.abs(s).toFixed(2),
          items: map[d].items,
        };
      });
  },

  onPeriodTap(e) {
    const p = e.currentTarget.dataset.p;
    if (this.data.period === p) return;
    this.setData({ period: p, page: 1 });
    this.load(true);
  },

  onMonthChange(e) {
    this.setData({ month: e.detail.value, page: 1 });
    this.load(true);
  },

  onYearChange(e) {
    this.setData({ year: e.detail.value, page: 1 });
    this.load(true);
  },

  onStartDateChange(e) {
    this.setData({ startDate: e.detail.value, page: 1 });
    this.load(true);
  },

  onEndDateChange(e) {
    this.setData({ endDate: e.detail.value, page: 1 });
    this.load(true);
  },

  // 类型筛选：支出/收入互斥（收入没有大类小类，切到收入时清空分类筛选）
  onTypeTap(e) {
    const v = e.currentTarget.dataset.v;
    if (this.data.typeFilter === v) return;
    const patch = { typeFilter: v, page: 1 };
    if (v === 'income') {
      patch.selectedBigs = [];
      patch.expanded = { daily: false, race: false };
      patch.selectedSmalls = { daily: [], race: [] };
      patch.bigSel = { daily: false, race: false };
      patch.smallSel = { daily: {}, race: {} };
    }
    this.setData(patch);
    this.load(true);
  },

  // 大类：点击选中/取消 + 展开/收起小类；取消时清空该大类已选小类
  onBigTap(e) {
    const v = e.currentTarget.dataset.v;
    const selectedBigs = [...this.data.selectedBigs];
    const expanded = { ...this.data.expanded };
    const selectedSmalls = { ...this.data.selectedSmalls, [v]: [...(this.data.selectedSmalls[v] || [])] };
    const bigSel = { ...this.data.bigSel };
    const smallSel = { ...this.data.smallSel, [v]: { ...(this.data.smallSel[v] || {}) } };
    const idx = selectedBigs.indexOf(v);
    if (idx >= 0) {
      selectedBigs.splice(idx, 1);
      expanded[v] = false;
      selectedSmalls[v] = [];
      smallSel[v] = {};
    } else {
      selectedBigs.push(v);
      expanded[v] = true;
    }
    bigSel[v] = selectedBigs.includes(v);
    this.setData({ selectedBigs, expanded, selectedSmalls, bigSel, smallSel, page: 1 });
    this.load(true);
  },

  // 小类：多选
  onSmallTap(e) {
    const { big, v } = e.currentTarget.dataset;
    const arr = [...(this.data.selectedSmalls[big] || [])];
    const i = arr.indexOf(v);
    if (i >= 0) arr.splice(i, 1); else arr.push(v);
    const smallSel = { ...this.data.smallSel, [big]: { ...(this.data.smallSel[big] || {}) } };
    smallSel[big][v] = arr.includes(v);
    this.setData({ [`selectedSmalls.${big}`]: arr, smallSel, page: 1 });
    this.load(true);
  },

  onClearFilter() {
    this.setData({
      selectedBigs: [],
      expanded: { daily: false, race: false },
      selectedSmalls: { daily: [], race: [] },
      bigSel: { daily: false, race: false },
      smallSel: { daily: {}, race: {} },
      page: 1,
    });
    this.load(true);
  },

  onItemTap(e) {
    wx.navigateTo({ url: `/pages/tools/ledger/add?id=${e.currentTarget.dataset.id}` });
  },

  onPreviewImg(e) {
    const { id, idx } = e.currentTarget.dataset;
    const urls = [];
    this.data.groups.forEach(g => g.items.forEach(it => { if (it._id === id) urls.push(...it._images); }));
    if (!urls.length) return;
    wx.previewImage({ urls, current: urls[idx] });
  },

  onLoadMore() {
    this.setData({ page: this.data.page + 1 });
    this.load(false);
  },

  onAdd() {
    wx.navigateTo({ url: '/pages/tools/ledger/add' });
  },
});