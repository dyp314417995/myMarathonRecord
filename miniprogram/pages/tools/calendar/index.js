// pages/tools/calendar/index.js - 赛事日历
const raceUtil = require('../../../utils/raceEvents');

Page({
  data: {
    tab: 'mine',          // all | mine | review
    races: [],
    allRaces: [],
    allTags: [],           // 所有可用标签
    myMarkers: {},         // eventId -> markerStatus
    myMarkersData: {},     // eventId -> full marker data (with notifyEnabled)
    myReviewIds: {},       // eventId -> true (用户评价过的赛事)
    sortBy: 'date',        // date | score | difficulty | atmosphere | supply | transport | scenery | org | medal | value
    sortAsc: true,   // 默认时间从近到远
    tagFilter: '',
    raceTypeFilter: '',   // 类型筛选
    raceLevelFilter: '',  // 等级筛选
    raceLabelFilter: '',  // 标牌筛选
    searchKey: '',
    showForm: false,
    markingEventId: '',
    markingEventName: '',
    markingEvent: null,      // 完整赛事信息
    selectedStatus: 'planned',
    markRaceType: 'full',     // 混合赛事选择的项目
    hours: ['0','1','2','3','4','5','6','7','8','9','10'],
    minutes: Array.from({length:60},(_,i)=>String(i).padStart(2,'0')),
    seconds: Array.from({length:60},(_,i)=>String(i).padStart(2,'0')),
    raceHIdx: 3, raceMIdx: 30, raceSIdx: 0,
    notifyEnabled: false,     // 倒计时通知开关
    // 时间范围
    dateFrom: '',
    dateTo: '',
    dateRangeText: '',
  },

  onLoad() {
    // 恢复上次的 tab
    const saved = wx.getStorageSync('calendar_tab');
    if (saved) this.setData({ tab: saved });
  },

  onShow() {
    this.setDefaultDates();
    this.loadData();
  },

  onHide() {
    // 记住当前 tab
    wx.setStorageSync('calendar_tab', this.data.tab);
  },

  setDefaultDates() {
    const today = new Date();
    const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    let from, to;
    if (this.data.tab === 'mine') {
      // 我的赛事：今年一整年
      from = new Date(today.getFullYear(), 0, 1);
      to = new Date(today.getFullYear(), 11, 31);
    } else if (this.data.tab === 'review') {
      from = new Date(today.getFullYear(), today.getMonth() - 5, 1);
      to = today;
    } else {
      to = new Date(today.getFullYear(), today.getMonth() + 5 + 1, 0);
      from = today;
    }
    this.setData({
      dateFrom: fmt(from),
      dateTo: fmt(to),
      dateRangeText: `${fmt(from)} ~ ${fmt(to)}`,
    });
  },

  async loadData() {
    wx.showLoading({ title: '加载中' });
    try {
      const userInfo = wx.getStorageSync('userInfo');
      const userId = userInfo ? (userInfo._id || userInfo.openid) : null;

      const res = await raceUtil.getAll({
        search: this.data.searchKey,
        dateFrom: this.data.dateFrom,
        dateTo: this.data.dateTo,
        raceType: this.data.tab === 'review' ? '' : this.data.raceTypeFilter,
        raceLevel: this.data.tab === 'review' ? '' : this.data.raceLevelFilter,
        raceLabel: this.data.tab === 'review' ? '' : this.data.raceLabelFilter,
        userId,
      });
      const all = res.list;
      if (all.length === 0) {
        wx.hideLoading();
        this.setData({ races: [], allRaces: [], allTags: [], dateRangeText: '', total: 0, hasMore: false });
        return;
      }

      const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      const from = new Date(this.data.dateFrom);
      const to = new Date(this.data.dateTo);
      this.setData({ dateRangeText: `${fmt(from)} ~ ${fmt(to)}`, total: res.total, hasMore: res.hasMore });

      let races = all;

      const tagSet = new Set();
      races.forEach(r => (r.tags || []).forEach(t => tagSet.add(t)));
      const allTags = [...tagSet];

      // 评分已由云函数批量返回
      const reviewMap = {};
      races.forEach(r => { if (r.reviewStats) reviewMap[r._id] = r.reviewStats; });

      // 已标记人数统计
      const markerMap = {};
      try {
        const db = require('../../../utils/db').db;
        const mkRes = await db.collection('race_markers').get();
        (mkRes.data || []).forEach(m => {
          markerMap[m.eventId] = (markerMap[m.eventId] || 0) + 1;
        });
      } catch {}

      if (userId) {
        try { const mkRes = await raceUtil.getMyMarkers(userId); const mMap = {}; const mData = {}; mkRes.data.forEach(m => { mMap[m.eventId] = m.status; mData[m.eventId] = m; }); this.setData({ myMarkers: mMap, myMarkersData: mData }); } catch {}
        try { const rvMap = {}; const allRv = await wx.cloud.callFunction({ name: 'getRaceReviews', data: { action: 'all', userId } }); (allRv.result||[]).forEach(r => { rvMap[r.eventId] = true; }); this.setData({ myReviewIds: rvMap }); } catch {}
      }

      // 兼容旧标签名
      races.forEach(r => {
        if (r.timeline) {
          const labelMap = { '开启报名': '报名开启', '截止报名': '报名截止', '截止退费': '退费截止', '缴费截止时间': '缴费截止', '举办日期': '鸣枪开跑' };
          r.timeline = r.timeline.map(t => ({ ...t, label: labelMap[t.label] || t.label }));
        }
      });

      races = races.map(r => ({
        ...r,
        raceTypeName: (r.raceTypes || [r.raceType || 'full']).map(t => ({ full: '全马', half: '半马', '10k': '10K', trail: '越野' }[t] || t)).join('·'),
        countdown: this.calcCountdown(r.date, r.timeline, r.gunTimes),
        isMine: !!this.data.myMarkers[r._id],
        myStatus: this.data.myMarkers[r._id] || '',
        myNotify: (this.data.myMarkersData[r._id] && this.data.myMarkersData[r._id].notifyEnabled) || false,
        regNotOpen: this.isRegNotOpen(r.timeline),  // 报名未开启
        // 列表卡片：单赛事统计；详情页：赛事组统计
        avgScore: r.avgScore || 0,
        reviewCount: r.reviewCount || 0,
        markerCount: markerMap[r._id] || 0,
        dimensions: r.reviewStats ? r.reviewStats.dimensions : {},
        hasReviewed: r.hasReviewed || false,
      }));

      this.setData({ allRaces: races, allTags });
      this.applyFilter();
      wx.hideLoading();
    } catch (err) {
      wx.hideLoading();
    }
  },

  isRegNotOpen(timeline) {
    if (!timeline || !timeline.length) return false;
    const regOpen = timeline.find(t => t.label === '报名开启');
    if (!regOpen || !regOpen.date) return false;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const d = new Date(regOpen.date);
    d.setHours(0, 0, 0, 0);
    return d > today;
  },

  calcCountdown(dateStr, timeline, gunTimes) {
    const now = new Date();
    const toDate = (v) => v instanceof Date ? v : new Date(v);

    // 找最早发枪时间（用于时间轴节点补充和兜底）
    let firstGun = null;
    if (gunTimes && gunTimes.length) {
      gunTimes.forEach(g => {
        if (!g.time) return;
        const rd = dateStr ? toDate(dateStr) : new Date();
        const [h, m] = g.time.split(':');
        rd.setHours(+h || 0, +m || 0, 0, 0);
        if (!firstGun || rd < firstGun) firstGun = rd;
      });
    }

    // 优先找最近的下一个时间节点（含发枪时间）
    let nearestLabel = '', nearestMs = Infinity;
    if (timeline && timeline.length) {
      timeline.forEach(t => {
        if (!t.date) return;
        const td = toDate(t.date);
        if (isNaN(td.getTime())) return;
        // 鸣枪开跑用最早发枪时间
        if (t.label === '鸣枪开跑' && firstGun) {
          const diffMs = firstGun - now;
          if (diffMs >= 0 && diffMs < nearestMs) { nearestMs = diffMs; nearestLabel = '鸣枪开跑'; }
          return;
        }
        if (t.time) { const [h, m] = t.time.split(':'); td.setHours(+h || 0, +m || 0, 0, 0); }
        else td.setHours(0, 0, 0, 0);
        const diffMs = td - now;
        if (diffMs >= 0 && diffMs < nearestMs) { nearestMs = diffMs; nearestLabel = t.label; }
      });
    }
    // 没有时间轴但有发枪时间
    if (!nearestLabel && firstGun) {
      const diffMs = firstGun - now;
      if (diffMs >= 0) { nearestMs = diffMs; nearestLabel = '鸣枪开跑'; }
    }
    if (nearestLabel) {
      const label = nearestLabel.replace('时间', '');
      const diffHours = Math.round(nearestMs / 3600000);
      if (diffHours < 1) return `即将${label}`;
      if (diffHours < 24) return `距${label} ${diffHours} 小时`;
      return `距${label} ${Math.ceil(nearestMs / 86400000)} 天`;
    }

    // 兜底：用赛事日期
    if (!dateStr) return '';
    const rd = toDate(dateStr);
    if (isNaN(rd.getTime())) return '';
    const diffMs = rd - now;
    if (diffMs > 0) { const d2 = Math.ceil(diffMs / 86400000); return `距鸣枪开跑 ${d2} 天`; }
    if (Math.abs(diffMs) < 86400000) return '今天鸣枪开跑';
    return `已举办 ${Math.ceil(Math.abs(diffMs) / 86400000)} 天`;
  },

  applyFilter() {
    let races = [...this.data.allRaces];
    if (this.data.tab === 'mine') races = races.filter(r => r.isMine);
    if (this.data.tab === 'review') races = races.filter(r => r.hasReviewed);
    if (this.data.searchKey) races = races.filter(r => (r.name||'').toLowerCase().includes(this.data.searchKey.toLowerCase()) || (r.city||'').toLowerCase().includes(this.data.searchKey.toLowerCase()));
    if (this.data.tagFilter) races = races.filter(r => (r.tags || []).includes(this.data.tagFilter));
    if (this.data.raceTypeFilter) races = races.filter(r => (r.raceTypes || [r.raceType]).includes(this.data.raceTypeFilter));
    if (this.data.raceLevelFilter) races = races.filter(r => r.raceLevel === this.data.raceLevelFilter);
    if (this.data.raceLabelFilter) races = races.filter(r => r.label === this.data.raceLabelFilter);
    const sb = this.data.sortBy;
    const asc = this.data.sortAsc;
    const dimKeys = ['difficulty','atmosphere','supply','transport','scenery','org','medal','value'];
    if (sb === 'date') { races.sort((a, b) => asc ? new Date(a.date) - new Date(b.date) : new Date(b.date) - new Date(a.date)); }
    else if (sb === 'score') { races.sort((a, b) => asc ? (a.avgScore || 0) - (b.avgScore || 0) : (b.avgScore || 0) - (a.avgScore || 0)); }
    else if (dimKeys.includes(sb)) { races.sort((a, b) => asc ? ((a.dimensions||{})[sb] || 0) - ((b.dimensions||{})[sb] || 0) : ((b.dimensions||{})[sb] || 0) - ((a.dimensions||{})[sb] || 0)); }
    this.setData({ races });
  },

  onTab(e) {
    const t = e.currentTarget.dataset.t;
    this.setData({ tab: t });
    wx.setStorageSync('calendar_tab', t);
    this.setDefaultDates();
    this.loadData();
  },

  onSort(e) {
    const v = e.currentTarget.dataset.v;
    if (this.data.sortBy === v) {
      this.setData({ sortAsc: !this.data.sortAsc });
    } else {
      this.setData({ sortBy: v, sortAsc: v === 'date' ? true : false });
    }
    this.applyFilter();
  },

  onTagFilter(e) {
    const tag = e.currentTarget.dataset.tag;
    this.setData({ tagFilter: this.data.tagFilter === tag ? '' : tag });
    this.applyFilter();
  },

  onRaceTypeFilter(e) {
    const v = e.currentTarget.dataset.v;
    this.setData({ raceTypeFilter: this.data.raceTypeFilter === v ? '' : v });
    this.applyFilter();
  },
  onRaceLevelFilter(e) {
    const v = e.currentTarget.dataset.v;
    this.setData({ raceLevelFilter: this.data.raceLevelFilter === v ? '' : v });
    this.applyFilter();
  },
  onRaceLabelFilter(e) {
    const v = e.currentTarget.dataset.v;
    this.setData({ raceLabelFilter: this.data.raceLabelFilter === v ? '' : v });
    this.applyFilter();
  },

  onSearch(e) {
    this.setData({ searchKey: e.detail.value });
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => this.applyFilter(), 300);
  },

  onDateFrom(e) { this.setData({ dateFrom: e.detail.value }); this.loadData(); },
  onDateTo(e) { this.setData({ dateTo: e.detail.value }); this.loadData(); },

  onShowMark(e) {
    const id = e.currentTarget.dataset.id;
    const event = this.data.allRaces.find(r => r._id === id) || {};
    const existingMarker = this.data.myMarkersData ? this.data.myMarkersData[id] : null;
    // 根据赛事类型设完赛时间默认值
    const primaryType = (event.raceTypes || [event.raceType || 'full'])[0];
    const defaults = { full: { h: 3, m: 30, s: 0 }, half: { h: 2, m: 0, s: 0 }, '10k': { h: 0, m: 50, s: 0 }, trail: { h: 3, m: 30, s: 0 } };
    const d = defaults[primaryType] || defaults.full;
    this.setData({
      showForm: true, markingEventId: id, markingEventName: event.name || '',
      markingEvent: event,
      markRaceType: (event.raceTypes || ['full'])[0] || 'full',
      selectedStatus: this.data.myMarkers[id] || 'planned',
      raceHIdx: d.h, raceMIdx: d.m, raceSIdx: d.s,
      notifyEnabled: existingMarker ? existingMarker.notifyEnabled || false : false,
    });
  },

  async onMark() {
    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo) return wx.showToast({ title: '请先登录', icon: 'none' });
    const { markingEventId, selectedStatus, markingEvent, notifyEnabled, hours, minutes, seconds, raceHIdx, raceMIdx, raceSIdx } = this.data;
    const raceResult = `${hours[raceHIdx]}:${minutes[raceMIdx]}:${seconds[raceSIdx]}`;
    // 开启通知时申请订阅消息授权
    if (notifyEnabled) {
      try {
        await wx.requestSubscribeMessage({ tmplIds: ['xepY9QmUT4YPXUt7mLhQrtlVBcN01eGkk-NqH0Av5Ew'] });
      } catch {}
    }
    wx.showLoading({ title: '保存中' });
    try {
      await raceUtil.markEvent(userInfo._id, markingEventId, selectedStatus, notifyEnabled, this.data.markRaceType);

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
      console.error('标记失败:', err);
      wx.showToast({ title: '保存失败: ' + (err.message || err.errMsg || '未知'), icon: 'none', duration: 3000 });
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
  onMarkRaceType(e) { this.setData({ markRaceType: e.currentTarget.dataset.v }); },

  onNotifyToggle(e) { this.setData({ notifyEnabled: e.detail.value }); },

  onResultPick(e) {
    const { field } = e.currentTarget.dataset;
    const val = e.detail.value;
    if (field === 'h') this.setData({ raceHIdx: val });
    else if (field === 'm') this.setData({ raceMIdx: val });
    else if (field === 's') this.setData({ raceSIdx: val });
  },

  onResultInput(e) { this.setData({ raceResult: e.detail.value }); },

  onRaceDetail(e) {
    wx.navigateTo({ url: `/pages/tools/calendar/detail?id=${e.currentTarget.dataset.id}` });
  },
});
