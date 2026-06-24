// pages/tools/calendar/index.js - 赛事日历
const raceUtil = require('../../../utils/raceEvents');

Page({
  data: {
    tab: 'all',           // all | mine | review
    races: [],
    allRaces: [],
    allTags: [],           // 所有可用标签
    myMarkers: {},         // eventId -> markerStatus
    myReviewIds: {},       // eventId -> true (用户评价过的赛事)
    sortBy: 'date',        // date | score | difficulty | atmosphere | supply | transport | scenery | org | medal | value
    sortAsc: false,
    tagFilter: '',
    searchKey: '',
    showForm: false,
    markingEventId: '',
    markingEventName: '',
    markingEvent: null,      // 完整赛事信息
    selectedStatus: 'planned',
    raceResult: '',           // 完赛成绩
    // 时间范围
    dateFrom: '',
    dateTo: '',
    dateRangeText: '',
    showDatePicker: false,
  },

  onShow() {
    this.loadData();
  },

  async loadData() {
    wx.showLoading({ title: '加载中' });
    try {
      const userInfo = wx.getStorageSync('userInfo');
      const userId = userInfo ? userInfo._id : null;

      const all = await raceUtil.getAll();
      const today = new Date(); today.setHours(0,0,0,0);
      const yearEnd = new Date(today.getFullYear(), 11, 31); // 今年年底

      const from = this.data.dateFrom ? new Date(this.data.dateFrom) : today;
      const to = this.data.dateTo ? new Date(this.data.dateTo) : yearEnd;

      // 时间范围文本
      const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      this.setData({ dateRangeText: `${fmt(from)} ~ ${fmt(to)}` });

      let races = all.filter(r => {
        if (!r.date) return false;
        const d = r.date instanceof Date ? r.date : new Date(r.date);
        if (isNaN(d.getTime())) return false;
        return d >= from && d <= to;
      });

      // 收集所有标签
      const tagSet = new Set();
      races.forEach(r => (r.tags || []).forEach(t => tagSet.add(t)));
      const allTags = [...tagSet];

      // 批量加载评分统计
      const reviewMap = {};
      for (const r of races) {
        try {
          const stats = await raceUtil.getReviewStats(r._id);
          reviewMap[r._id] = stats;
        } catch {}
      }

      if (userId) {
        const mkRes = await raceUtil.getMyMarkers(userId);
        const mMap = {};
        mkRes.data.forEach(m => { mMap[m.eventId] = m.status; });
        this.setData({ myMarkers: mMap });

        // 加载用户评价过的赛事
        const db = require('../../../utils/db').db;
        const rvRes = await db.collection('race_reviews').where({ userId }).get();
        const rvMap = {};
        rvRes.data.forEach(r => { rvMap[r.eventId] = true; });
        this.setData({ myReviewIds: rvMap });
      }

      races = races.map(r => ({
        ...r,
        countdown: this.calcCountdown(r.date, r.timeline),
        isMine: !!this.data.myMarkers[r._id],
        myStatus: this.data.myMarkers[r._id] || '',
        avgScore: reviewMap[r._id] ? reviewMap[r._id].avgScore : (r.avgScore || 0),
        reviewCount: reviewMap[r._id] ? reviewMap[r._id].count : (r.reviewCount || 0),
        dimensions: reviewMap[r._id] ? reviewMap[r._id].dimensions : {},
      }));

      this.setData({ allRaces: races, allTags });
      this.applyFilter();
      wx.hideLoading();
    } catch (err) {
      wx.hideLoading();
    }
  },

  calcCountdown(dateStr, timeline) {
    const today = new Date(); today.setHours(0,0,0,0);
    const toDate = (v) => v instanceof Date ? v : new Date(v);

    let nearestLabel = ''; let nearestDiff = Infinity;
    if (timeline && timeline.length) {
      timeline.forEach(t => {
        if (!t.date) return;
        const td = toDate(t.date);
        if (isNaN(td.getTime())) return;
        const diff = Math.ceil((td - today) / 86400000);
        if (diff >= 0 && diff < nearestDiff) { nearestDiff = diff; nearestLabel = t.label; }
      });
    }
    if (nearestLabel && nearestDiff > 0) return `距${nearestLabel} ${nearestDiff} 天`;
    if (nearestLabel && nearestDiff === 0) return `今天是${nearestLabel}`;

    if (!dateStr) return '';
    const rd = toDate(dateStr);
    if (isNaN(rd.getTime())) return '';
    const diff = Math.ceil((rd - today) / 86400000);
    if (diff > 0) return `距开赛 ${diff} 天`;
    if (diff === 0) return '今天开赛';
    return `已举办 ${Math.abs(diff)} 天`;
  },

  applyFilter() {
    let races = [...this.data.allRaces];
    // Tab
    if (this.data.tab === 'mine') {
      races = races.filter(r => r.isMine);
    }
    if (this.data.tab === 'review') {
      races = races.filter(r => this.data.myReviewIds[r._id]);
    }
    // 搜索
    if (this.data.searchKey) {
      const kw = this.data.searchKey.toLowerCase();
      races = races.filter(r => (r.name||'').toLowerCase().includes(kw) || (r.city||'').toLowerCase().includes(kw));
    }
    // 标签
    if (this.data.tagFilter) {
      races = races.filter(r => (r.tags || []).includes(this.data.tagFilter));
    }
    // 排序
    const sb = this.data.sortBy;
    const dimKeys = ['difficulty','atmosphere','supply','transport','scenery','org','medal','value'];
    if (sb === 'date') {
      races.sort((a, b) => this.data.sortAsc ? new Date(a.date) - new Date(b.date) : new Date(b.date) - new Date(a.date));
    } else if (sb === 'score') {
      races.sort((a, b) => (b.avgScore || 0) - (a.avgScore || 0));
    } else if (dimKeys.includes(sb)) {
      races.sort((a, b) => ((b.dimensions||{})[sb] || 0) - ((a.dimensions||{})[sb] || 0));
    }
    this.setData({ races });
  },

  onTab(e) {
    this.setData({ tab: e.currentTarget.dataset.t });
    this.applyFilter();
  },

  onSort(e) {
    this.setData({ sortBy: e.currentTarget.dataset.v, sortAsc: e.currentTarget.dataset.v === 'date' ? !this.data.sortAsc : false });
    this.applyFilter();
  },

  onTagFilter(e) {
    const tag = e.currentTarget.dataset.tag;
    this.setData({ tagFilter: this.data.tagFilter === tag ? '' : tag });
    this.applyFilter();
  },

  onSearch(e) {
    this.setData({ searchKey: e.detail.value });
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => this.applyFilter(), 300);
  },

  onDateFrom(e) { this.setData({ dateFrom: e.detail.value }); },
  onDateTo(e) { this.setData({ dateTo: e.detail.value }); },
  onApplyDate() { this.loadData(); },
  onToggleDate() { this.setData({ showDatePicker: !this.data.showDatePicker }); },

  onShowMark(e) {
    const id = e.currentTarget.dataset.id;
    const event = this.data.allRaces.find(r => r._id === id) || {};
    this.setData({
      showForm: true, markingEventId: id, markingEventName: event.name || '',
      markingEvent: event,
      selectedStatus: this.data.myMarkers[id] || 'planned',
      raceResult: '',
    });
  },

  async onMark() {
    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo) return wx.showToast({ title: '请先登录', icon: 'none' });
    const { markingEventId, selectedStatus, raceResult, markingEvent } = this.data;
    wx.showLoading({ title: '保存中' });
    try {
      await raceUtil.markEvent(userInfo._id, markingEventId, selectedStatus);

      // 如果标记为已完赛且有成绩，同步到跑马记录
      if (selectedStatus === 'finished' && raceResult && markingEvent) {
        const db = require('../../../utils/db').db;
        const eventDate = markingEvent.fmtDate || this.fmtDateStr(markingEvent.date);

        // 检查是否已同步过
        const existRecord = await db.collection('race_records').where({
          userId: userInfo._id,
          city: markingEvent.name
        }).get();

        if (existRecord.data.length === 0) {
          const recordData = {
            userId: userInfo._id,
            raceType: markingEvent.raceType || 'full',
            raceLevel: markingEvent.raceLevel || 'B',
            status: 'finished',
            date: eventDate,
            city: markingEvent.name,
            result: raceResult,
            distance: markingEvent.distance || '',
            elevation: markingEvent.elevation || '',
            isPublic: true,
            images: [],
            createTime: new Date(),
          };
          const addRes = await db.collection('race_records').add({ data: recordData });

          // 更新 marker 的 recordId
          const mkRes = await db.collection('race_markers').where({
            userId: userInfo._id, eventId: markingEventId
          }).get();
          if (mkRes.data.length > 0) {
            await db.collection('race_markers').doc(mkRes.data[0]._id).update({
              data: { recordId: addRes._id }
            });
          }

          // 检查 PB
          await this.checkPB(markingEvent.raceType, raceResult, userInfo);
        }
      }

      wx.hideLoading();
      wx.showToast({ title: '已标记', icon: 'success' });
      this.setData({ showForm: false });
      this.loadData();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  fmtDateStr(d) {
    const dt = new Date(d);
    return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
  },

  async checkPB(type, result, userInfo) {
    const dbUtil = require('../../../utils/db');
    const fields = { '10k': 'pb10k', half: 'pbHalf', full: 'pbFull' };
    const field = fields[type];
    if (!field) return;
    const current = userInfo[field];
    const toSec = (t) => { const p = (t||'').split(':'); return +p[0]*3600 + +p[1]*60 + +(p[2]||0); };
    const newSec = toSec(result);
    if (!current || newSec < toSec(current)) {
      await dbUtil.updateUser(userInfo._id, { [field]: result });
      userInfo[field] = result;
      wx.setStorageSync('userInfo', userInfo);
      wx.showToast({ title: '🏆 新PB！', icon: 'success', duration: 2000 });
    }
  },

  async onUnmark() {
    const userInfo = wx.getStorageSync('userInfo');
    const id = this.data.markingEventId;
    await raceUtil.unmarkEvent(userInfo._id, id);
    wx.showToast({ title: '已取消标记', icon: 'success' });
    this.setData({ showForm: false });
    this.loadData();
  },

  onHideForm() { this.setData({ showForm: false }); },

  onStatusSel(e) { this.setData({ selectedStatus: e.currentTarget.dataset.v }); },

  onResultInput(e) { this.setData({ raceResult: e.detail.value }); },

  onRaceDetail(e) {
    wx.navigateTo({ url: `/pages/tools/calendar/detail?id=${e.currentTarget.dataset.id}` });
  },
});
