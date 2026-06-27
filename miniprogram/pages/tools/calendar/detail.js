// pages/tools/calendar/detail.js - 赛事详情
const raceUtil = require('../../../utils/raceEvents');

Page({
  data: {
    eventId: '',
    event: {},
    reviewStats: null,
    topTags: [],
    isMine: false,
    myStatus: '',
    myReview: null,
    otherReviews: [],      // 他人评价列表
    reviewPage: 0,
    reviewTotal: 0,
    reviewHasMore: false,
    raceGroup: '',
    scoreTab: 'all',  // all | full | half
    reviewTypeFilter: '',
    showAllTimeline: false,
  },

  onScoreTab(e) { this.setData({ scoreTab: e.currentTarget.dataset.t }); },
  onToggleTimeline() { this.setData({ showAllTimeline: !this.data.showAllTimeline }); },
  onReviewTypeFilter(e) {
    const v = e.currentTarget.dataset.v;
    this.setData({ reviewTypeFilter: this.data.reviewTypeFilter === v ? '' : v });
  },

  onLoad(options) {
    if (!options.id) return;
    this.setData({ eventId: options.id });
    this.loadEvent();
  },

  onShow() {
    // 从评价页返回后刷新（评价页会设 needRefresh 标志）
    const needRefresh = this.data._needRefresh;
    if (needRefresh) {
      this.setData({ _needRefresh: false });
      this.loadEvent();
    }
  },

  async loadEvent() {
    wx.showLoading({ title: '加载中' });
    try {
      const res = await raceUtil.getAll({ limit: 200 });
      const event = (res.list || []).find(r => r._id === this.data.eventId);
      if (!event) { wx.showToast({ title: '赛事不存在', icon: 'none' }); return; }

      let stats = event.reviewStats || { count: 0, avgScore: 0, dimensions: {}, tagStats: {} };
      if (!stats.count) { try { stats = await raceUtil.getReviewStats(this.data.eventId); } catch {} }
      const tagEntries = Object.entries(stats.tagStats || {})
        .sort((a, b) => b[1] - a[1]).slice(0, 10);

      const userInfo = wx.getStorageSync('userInfo');
      let isMine = false, myStatus = '', myReview = null;
      if (userInfo) {
        try {
          const mkRes = await raceUtil.getMyMarkers(userInfo._id);
          const mine = mkRes.data.find(m => m.eventId === this.data.eventId);
          if (mine) { isMine = true; myStatus = mine.status; }
        } catch {}

        try {
          const allRv = await wx.cloud.callFunction({ name: 'getRaceReviews', data: { action: 'all', userId: userInfo._id } });
          myReview = (allRv.result || []).find(r => r.eventId === this.data.eventId) || null;
        } catch {}
      }

      // 把赛事鸣枪开跑日期注入时间轴（如果还没在 timeline 中）
      let timeline = event.timeline || [];
      const hasRaceDate = timeline.some(t => t.label === '鸣枪开跑' || t.label === '举办日期');
      if (!hasRaceDate && event.date) {
        timeline = [...timeline, { label: '鸣枪开跑', date: event.date, time: '' }];
      }
      // 兼容旧数据"举办日期" → "鸣枪开跑"
      timeline = timeline.map(t => t.label === '举办日期' ? { ...t, label: '鸣枪开跑' } : t);
      // 用最早 gunTime 同步鸣枪开跑时间
      if (event.gunTimes && event.gunTimes.length) {
        const sorted = [...event.gunTimes].filter(g => g.time).sort((a, b) => a.time.localeCompare(b.time));
        if (sorted.length && sorted[0].time) {
          const gunNode = timeline.find(t => t.label === '鸣枪开跑');
          if (gunNode) gunNode.time = sorted[0].time;
        }
      }
      const processedTimeline = this.processTimeline(timeline);

      this.setData({
        event: {
          ...event,
          fmtDate: this.fmtDate(event.date),
          countdown: this.calcCountdown(event.date, timeline, event.gunTimes),
          raceTypeName: (event.raceTypes || [event.raceType || 'full']).map(t => ({ full: '全马', half: '半马', '10k': '10K', trail: '越野' }[t] || t)).join('·'),
          timeline: processedTimeline,
        },
        raceGroup: event.raceGroup || '',
        reviewStats: stats,
        topTags: tagEntries,
        isMine, myStatus, myReview,
        myReviewTags: myReview ? (myReview.tags || []).join('、') : '',
        'myReview.myAvg': myReview && myReview.scores ? Math.round((myReview.scores.difficulty + myReview.scores.atmosphere + myReview.scores.supply + myReview.scores.transport) / 0.4) / 10 : 0,
      });
      wx.hideLoading();
      // 加载他人评价
      if (event.raceGroup) this.loadOtherReviews();
    } catch (err) {
      wx.hideLoading();
      console.error('详情加载失败:', err);
      wx.showToast({ title: '加载失败: ' + (err.message || err.errMsg || '未知'), icon: 'none', duration: 3000 });
    }
  },

  fmtDate(d) {
    const dt = new Date(d);
    return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
  },

  calcCountdown(d, timeline, gunTimes) {
    const now = new Date();
    const toDate = (v) => v instanceof Date ? v : new Date(v);

    // 优先使用 gunTimes 最早发枪时间
    if (gunTimes && gunTimes.length) {
      let earliest = null;
      gunTimes.forEach(g => {
        if (!g.time) return;
        const raceDate = d ? toDate(d) : new Date();
        const [h, m] = g.time.split(':');
        raceDate.setHours(+h || 0, +m || 0, 0, 0);
        if (!earliest || raceDate < earliest) earliest = raceDate;
      });
      if (earliest) {
        const diffMs = earliest - now;
        if (diffMs > 0) { const d2 = Math.ceil(diffMs / 86400000); return `距开赛 ${d2} 天`; }
        if (Math.abs(diffMs) < 86400000) return '今天开赛';
        return `已举办 ${Math.ceil(Math.abs(diffMs) / 86400000)} 天`;
      }
    }
    // gunTimes 没找到，回退到原逻辑
    let nearestLabel = '', nearestMs = Infinity;
    if (timeline && timeline.length) {
      timeline.forEach(t => {
        if (!t.date) return;
        const td = toDate(t.date);
        if (isNaN(td.getTime())) return;
        if (t.time) { const [h, m] = t.time.split(':'); td.setHours(+h || 0, +m || 0, 0, 0); }
        else td.setHours(0, 0, 0, 0);
        const diffMs = td - now;
        if (diffMs >= 0 && diffMs < nearestMs) { nearestMs = diffMs; nearestLabel = t.label; }
      });
    }
    if (nearestLabel) {
      const diffHours = Math.round(nearestMs / 3600000);
      if (diffHours < 1) return `即将${nearestLabel}`;
      if (diffHours < 24) return `距${nearestLabel} ${diffHours} 小时`;
      const diffDays = Math.ceil(nearestMs / 86400000);
      return `距${nearestLabel} ${diffDays} 天`;
    }
    if (!d) return '';
    const rd = toDate(d);
    if (isNaN(rd.getTime())) return '';
    const diffMs = rd - now;
    if (diffMs > 0) { const d2 = Math.ceil(diffMs / 86400000); return `距开赛 ${d2} 天`; }
    if (Math.abs(diffMs) < 86400000) return '今天开赛';
    return `已举办 ${Math.ceil(Math.abs(diffMs) / 86400000)} 天`;
  },

  // 旧标签到新标签的映射
  labelMap: {
    '开启报名': '报名开启', '截止报名': '报名截止', '截止退费': '退费截止', '缴费截止时间': '缴费截止', '举办日期': '鸣枪开跑'
  },

  async loadOtherReviews() {
    const rg = this.data.raceGroup;
    if (!rg) return;
    try {
      const res = await wx.cloud.callFunction({
        name: 'getRaceReviews',
        data: { action: 'groupPage', raceGroup: rg, skip: 0, limit: 10 }
      });
      const r = res.result;
      const list = (r.list || []).map(item => ({
        ...item,
        myAvg: item.scores ? Math.round((item.scores.difficulty + item.scores.atmosphere + item.scores.supply + item.scores.transport) / 0.4) / 10 : 0,
        tagStr: (item.tags || []).join('、'),
      }));
      this.setData({
        otherReviews: list,
        reviewTotal: r.total || 0,
        reviewHasMore: list.length >= 10,
        reviewPage: 1,
      });
    } catch {}
  },

  async loadMoreReviews() {
    if (!this.data.reviewHasMore) return;
    try {
      const res = await wx.cloud.callFunction({
        name: 'getRaceReviews',
        data: { action: 'groupPage', raceGroup: this.data.raceGroup, skip: this.data.otherReviews.length, limit: 10 }
      });
      const r = res.result;
      const newItems = (r.list || []).map(item => ({
        ...item,
        myAvg: item.scores ? Math.round((item.scores.difficulty + item.scores.atmosphere + item.scores.supply + item.scores.transport) / 0.4) / 10 : 0,
        tagStr: (item.tags || []).join('、'),
      }));
      const list = [...this.data.otherReviews, ...newItems];
      this.setData({
        otherReviews: list,
        reviewHasMore: list.length < r.total,
        reviewPage: this.data.reviewPage + 1,
      });
    } catch {}
  },

  processTimeline(timeline) {
    if (!timeline || !timeline.length) return [];
    // 兼容旧标签名
    const map = this.labelMap || {};
    timeline = timeline.map(t => ({ ...t, label: map[t.label] || t.label }));
    const now = new Date();

    // 计算每个节点的精确时间
    const withTime = timeline.map(t => {
      let exact = null;
      if (t.date) {
        exact = new Date(t.date);
        if (!isNaN(exact.getTime())) {
          if (t.time) { const [h, m] = t.time.split(':'); exact.setHours(+h || 0, +m || 0, 0, 0); }
          else exact.setHours(0, 0, 0, 0);
        } else { exact = null; }
      }
      return { ...t, _exact: exact };
    });

    // 按精确时间排序
    const sorted = [...withTime].sort((a, b) => {
      if (!a._exact) return 1;
      if (!b._exact) return -1;
      return a._exact - b._exact;
    });

    let nextFound = false;
    return sorted.map(t => {
      let status = 'future';
      if (t._exact) {
        if (t._exact < now) {
          status = 'past';
        } else if (!nextFound) {
          status = 'next';
          nextFound = true;
        }
      }
      const dateStr = t.date ? this.fmtDate(t.date) : '';
      return { ...t, status, fmtDate: dateStr + (t.time ? ' ' + t.time : ''), _exact: undefined };
    });
  },

  onWebsite() {
    const url = this.data.event.website;
    if (url) {
      wx.setClipboardData({ data: url });
      wx.showToast({ title: '链接已复制', icon: 'success' });
    }
  },

  onReview() {
    this.setData({ _needRefresh: true });
    wx.navigateTo({ url: `/pages/tools/calendar/review?id=${this.data.eventId}&name=${this.data.event.name}` });
  },

  onShareAppMessage() {
    const { event } = this.data;
    return {
      title: `${event.name} · 赛事体验`,
      path: `/pages/tools/calendar/detail?id=${this.data.eventId}`,
      imageUrl: event.poster || '',
    };
  },

  onMark() {
    // 复用日历页的标记逻辑，简化版
    const { eventId, event, myStatus } = this.data;
    const statuses = ['planned', 'registered', 'won', 'lost', 'finished', 'dnf', 'dns'];
    const labels = ['计划报名', '已报名', '已中签', '未中签', '已完赛', '未完赛', '弃赛'];

    wx.showActionSheet({
      itemList: labels,
      success: async (res) => {
        const status = statuses[res.tapIndex];
        const userInfo = wx.getStorageSync('userInfo');
        if (!userInfo) return;
        await raceUtil.markEvent(userInfo._id, eventId, status);
        wx.showToast({ title: '已标记', icon: 'success' });
        this.setData({ myStatus: status, isMine: true });
      }
    });
  },

  onScoreDetail() {
    wx.navigateTo({ url: `/pages/tools/calendar/review-list?id=${this.data.eventId}&name=${this.data.event.name}` });
  },

  async onDelMyReview(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({ title: '删除评价', content: '将同时扣除10积分，之后重新评价可再次获得积分', confirmColor: '#ff4d4f', success: async (res) => {
      if (!res.confirm) return;
      const db = require('../../../utils/db').db;
      const userInfo = wx.getStorageSync('userInfo');
      const review = await db.collection('race_reviews').doc(id).get();

      // 删除评价
      await db.collection('race_reviews').doc(id).remove();

      // 扣减积分
      if (userInfo && review.data) {
        const pointsUtil = require('../../../utils/points');
        await pointsUtil.addRecord({
          userId: userInfo._id,
          type: 'use',
          category: '消耗',
          points: -10,
          description: `删除"${this.data.event.name}"赛事评价，扣减10积分`,
          images: [],
          earnDate: new Date(),
          expireDate: null,
          status: 'approved',
        });
        // 更新用户积分余额
        const balance = await pointsUtil.getBalance(userInfo._id);
        await db.collection('users').doc(userInfo._id).update({ data: { points: balance } });
      }

      // 更新赛事评分统计
      const raceUtil = require('../../../utils/raceEvents');
      const stats = await raceUtil.getReviewStats(this.data.eventId);
      const tagStats = {};
      Object.keys(stats.tagStats).forEach(k => { tagStats[k] = stats.tagStats[k]; });
      await db.collection('race_events').doc(this.data.eventId).update({
        data: { avgScore: stats.avgScore, reviewCount: stats.count, tagStats }
      });

      wx.showToast({ title: '已删除，-10积分', icon: 'success' });
      this.setData({ myReview: null });
      this.loadEvent();
    }});
  },

});
