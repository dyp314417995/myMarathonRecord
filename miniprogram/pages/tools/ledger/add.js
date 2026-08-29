// pages/tools/ledger/add.js - 记一笔 / 编辑
// 先选类型：支出（默认）/ 收入；收入不分大类小类，内置收入类型（比赛奖金等）
const ledger = require('../../../utils/ledger');
const shareUtil = require('../../../utils/share');

Page({
  data: {
    id: '',
    isEdit: false,
    entryType: 'expense',        // expense(支出) | income(收入)
    // 收入
    incomeTypes: ['比赛奖金', '其他'],
    incomeType: '',
    customIncome: '',
    // 支出
    bigCategory: 'daily',
    subs: ledger.DAILY_SUBS,
    smallCategory: '',
    customSmall: '',
    // 通用
    amount: '',
    date: '',
    note: '',
    images: [],          // [{ fileID, url }]
    submitting: false,
    // 比赛开支：赛事选择
    raceOptions: [],     // [{ _id, name, date }]（我的赛事）
    raceNames: [],       // picker 选项：['不选（通用比赛开支）', ...赛事名, '自定义赛事…']
    raceIdx: 0,
    customRace: '',
    eventName: '',
    eventId: '',
    showShareBtn: false,
  },

  onLoad(options) {
    shareUtil.enableShareMenu();
    const now = new Date();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    this.setData({ date: `${now.getFullYear()}-${m}-${d}` });
    if (options.id) {
      this.setData({ id: options.id, isEdit: true });
      this.loadDetail(options.id);
    } else if (options.eventId || options.eventName) {
      // 从「我的赛事」记录开销：自动选中赛事（比赛开支）
      this.setData({ bigCategory: 'race', subs: ledger.subsOf('race'), smallCategory: '', eventId: options.eventId || '', eventName: options.eventName || '' });
    }
  },

  onShow() {
    // 从「我的赛事」补标记后返回时刷新赛事列表（支出-比赛开支 / 收入 都有关联赛事入口）
    if ((this.data.entryType === 'expense' && this.data.bigCategory === 'race') || this.data.entryType === 'income') this.loadMyRaces();
  },

  async loadDetail(id) {
    wx.showLoading({ title: '加载中' });
    const res = await ledger.call('detail', { id });
    wx.hideLoading();
    if (!res.ok || !res.item) {
      wx.showToast({ title: res.msg || '加载失败', icon: 'none' });
      return;
    }
    const it = res.item;
    const entryType = it.entryType === 'income' ? 'income' : 'expense';
    const patch = {
      entryType,
      amount: String(it.amount),
      date: it.date,
      note: it.note || '',
      images: (it.images || []).map((fid, i) => ({ fileID: fid, url: (it._imageUrls || [])[i] || fid })),
    };
    if (entryType === 'income') {
      patch.incomeType = it.incomeType || '比赛奖金';
      patch.customIncome = (it.incomeType && !this.data.incomeTypes.includes(it.incomeType)) ? it.incomeType : '';
      patch.eventName = it.eventName || '';
      patch.eventId = it.eventId || '';
    } else {
      const subs = ledger.subsOf(it.bigCategory || 'daily');
      patch.bigCategory = it.bigCategory || 'daily';
      patch.subs = subs;
      patch.smallCategory = subs.includes(it.smallCategory) ? it.smallCategory : '其他';
      patch.customSmall = subs.includes(it.smallCategory) ? '' : it.smallCategory;
      patch.eventName = it.eventName || '';
      patch.eventId = it.eventId || '';
    }
    this.setData(patch);
    if ((entryType === 'expense' && (it.bigCategory || 'daily') === 'race') || entryType === 'income') this.loadMyRaces();
  },

  // 类型切换：支出 / 收入
  onTypeTap(e) {
    const v = e.currentTarget.dataset.v;
    if (this.data.entryType === v) return;
    const patch = { entryType: v };
    if (v === 'income') {
      patch.incomeType = this.data.incomeType || '比赛奖金';
    } else {
      patch.incomeType = '';
      patch.customIncome = '';
      // 切到支出且非比赛开支时清掉赛事关联（收入带来的关联不带到日常支出）
      if (this.data.bigCategory !== 'race') {
        patch.eventName = '';
        patch.eventId = '';
        patch.customRace = '';
        patch.raceIdx = 0;
      }
    }
    this.setData(patch);
    // 收入也支持关联赛事，切到收入时刷新赛事选项（含「不关联赛事」文案）
    if (v === 'income') this.loadMyRaces();
  },

  onIncomeTypeTap(e) {
    const v = e.currentTarget.dataset.v;
    this.setData({ incomeType: v });
  },

  onCustomIncomeInput(e) { this.setData({ customIncome: e.detail.value }); },

  // 加载我的赛事（已标记）
  async loadMyRaces() {
    const userInfo = wx.getStorageSync('userInfo');
    const res = await ledger.call('myRaces', { userId: userInfo ? userInfo._id : '' });
    const fallback = ['不选（通用比赛开支）', '自定义赛事…'];
    if (!res.ok) {
      console.warn('loadMyRaces failed:', res.msg);
      this.setData({ raceOptions: [], raceNames: fallback, raceIdx: 0 });
      wx.showToast({ title: '赛事列表加载失败', icon: 'none' });
      return;
    }
    const raceOptions = res.list || [];
    const noneLabel = this.data.entryType === 'income' ? '不关联赛事' : '不选（通用比赛开支）';
    const raceNames = [noneLabel, ...raceOptions.map(r => r.name), '自定义赛事…'];
    this.setData({ raceOptions, raceNames });
    this.syncRaceIdx();
  },

  syncRaceIdx() {
    const { eventId, eventName, raceOptions, raceNames } = this.data;
    if (!raceNames.length) return;
    let idx = 0;
    if (eventId) {
      const i = raceOptions.findIndex(r => r._id === eventId);
      idx = i >= 0 ? i + 1 : raceNames.length - 1;
    } else if (eventName) {
      idx = raceNames.length - 1;
    }
    this.setData({ raceIdx: idx });
  },

  onBigTap(e) {
    const v = e.currentTarget.dataset.v;
    const patch = { bigCategory: v, subs: ledger.subsOf(v), smallCategory: '', customSmall: '' };
    if (v === 'race') {
      this.loadMyRaces();
    } else {
      patch.eventName = '';
      patch.eventId = '';
      patch.raceIdx = 0;
      patch.customRace = '';
    }
    this.setData(patch);
  },

  onSmallTap(e) {
    this.setData({ smallCategory: e.currentTarget.dataset.v });
  },

  onCustomInput(e) { this.setData({ customSmall: e.detail.value }); },
  onAmountInput(e) { this.setData({ amount: e.detail.value }); },
  onDateChange(e) { this.setData({ date: e.detail.value }); },
  onNoteInput(e) { this.setData({ note: e.detail.value }); },

  onRaceChange(e) {
    const idx = Number(e.detail.value);
    const { raceOptions, raceNames } = this.data;
    const customIdx = raceNames.length - 1;
    let eventName = '';
    let eventId = '';
    if (idx > 0 && idx < customIdx) {
      const r = raceOptions[idx - 1];
      eventName = r.name;
      eventId = r._id;
    } else if (idx === customIdx) {
      eventName = this.data.customRace.trim();
    }
    this.setData({ raceIdx: idx, eventName, eventId });
  },

  onCustomRaceInput(e) {
    const v = e.detail.value;
    const patch = { customRace: v };
    if (this.data.raceIdx === this.data.raceNames.length - 1) {
      patch.eventName = v.trim();
      patch.eventId = '';
    }
    this.setData(patch);
  },

  // 快捷跳转：去我的赛事补充标记
  onGoMark() {
    wx.setStorageSync('calendar_tab', 'mine');
    wx.navigateTo({ url: '/pages/tools/calendar/index' });
  },

  // 选图上传（最多3张）
  onChooseImage() {
    const remain = 3 - this.data.images.length;
    if (remain <= 0) return;
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: async (res) => {
        wx.showLoading({ title: '上传中' });
        try {
          const added = [];
          for (const f of res.tempFiles) {
            const up = await wx.cloud.uploadFile({
              cloudPath: `ledger/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`,
              filePath: f.tempFilePath,
            });
            added.push({ fileID: up.fileID, url: f.tempFilePath });
          }
          this.setData({ images: [...this.data.images, ...added] });
        } catch (e) {
          wx.showToast({ title: '上传失败，请重试', icon: 'none' });
        }
        wx.hideLoading();
      },
    });
  },

  onRemoveImage(e) {
    const idx = e.currentTarget.dataset.idx;
    const images = [...this.data.images];
    images.splice(idx, 1);
    this.setData({ images });
  },

  onPreviewImage(e) {
    const idx = e.currentTarget.dataset.idx;
    const urls = this.data.images.map(i => i.url);
    wx.previewImage({ urls, current: urls[idx] });
  },

  async onSubmit() {
    if (this.data.submitting) return;
    const amount = parseFloat(this.data.amount);
    if (!(amount > 0)) { wx.showToast({ title: '请输入正确的金额', icon: 'none' }); return; }

    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo) { wx.navigateTo({ url: '/pages/login/login' }); return; }

    const payload = {
      entryType: this.data.entryType,
      amount,
      date: this.data.date,
      note: this.data.note,
      images: this.data.images.map(i => i.fileID),
    };

    if (this.data.entryType === 'income') {
      let incomeType = this.data.incomeType;
      if (incomeType === '其他') incomeType = this.data.customIncome.trim() || '其他';
      if (!incomeType) { wx.showToast({ title: '请选择收入类型', icon: 'none' }); return; }
      payload.incomeType = incomeType;
      // 收入也支持关联赛事
      payload.eventName = this.data.eventName;
      payload.eventId = this.data.eventId;
    } else {
      let smallCategory = this.data.smallCategory;
      if (smallCategory === '其他') {
        smallCategory = this.data.customSmall.trim() || '其他';
      }
      if (!smallCategory) { wx.showToast({ title: '请选择小类', icon: 'none' }); return; }
      payload.bigCategory = this.data.bigCategory;
      payload.smallCategory = smallCategory;
      payload.eventName = this.data.eventName;
      payload.eventId = this.data.eventId;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: '保存中' });
    const res = this.data.isEdit
      ? await ledger.call('update', { id: this.data.id, ...payload })
      : await ledger.call('add', payload);
    wx.hideLoading();
    this.setData({ submitting: false });
    if (!res.ok) { wx.showToast({ title: res.msg || '保存失败', icon: 'none' }); return; }
    wx.showToast({ title: '已保存', icon: 'success' });
    // 保存成功：显示分享按钮，不自动返回
    this.setData({ showShareBtn: true });
  },

  onShareAppMessage() {
    const race = this.data.eventName;
    return shareUtil.buildShare({
      title: race ? `快来看看「${race}」你花了多少钱` : '我用跑步账本记录跑步开销，你也试试',
      path: '/pages/tools/ledger/index',
    });
  },

  onShareTimeline() {
    const race = this.data.eventName;
    return shareUtil.buildTimeline({
      title: race ? `快来看看「${race}」你花了多少钱` : '我用跑步账本记录跑步开销，你也试试',
    });
  },

  onDelete() {
    wx.showModal({
      title: '删除这笔账',
      content: '删除后不可恢复，确定删除？',
      confirmColor: '#ff4d4f',
      success: async (r) => {
        if (!r.confirm) return;
        wx.showLoading({ title: '删除中' });
        const res = await ledger.call('remove', { id: this.data.id });
        wx.hideLoading();
        if (!res.ok) { wx.showToast({ title: res.msg || '删除失败', icon: 'none' }); return; }
        wx.showToast({ title: '已删除', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 800);
      },
    });
  },
});