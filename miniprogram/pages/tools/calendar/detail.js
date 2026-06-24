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
    myReview: null,       // 用户自己的评价
    isAdmin: false,
    allReviews: [],        // 管理员查看所有评价
  },

  async onLoad(options) {
    if (!options.id) return;
    this.setData({ eventId: options.id });
    await this.loadEvent();
  },

  async loadEvent() {
    wx.showLoading({ title: '加载中' });
    try {
      const all = await raceUtil.getAll();
      const event = all.find(r => r._id === this.data.eventId);
      if (!event) { wx.showToast({ title: '赛事不存在', icon: 'none' }); return; }

      const stats = await raceUtil.getReviewStats(this.data.eventId);
      const tagEntries = Object.entries(stats.tagStats || {})
        .sort((a, b) => b[1] - a[1]).slice(0, 10);

      const userInfo = wx.getStorageSync('userInfo');
      let isMine = false, myStatus = '', myReview = null;
      const role = (userInfo && userInfo.role) || 'user';
      const isAdmin = role === 'super_admin' || role === 'admin';

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

      this.setData({
        event: {
          ...event,
          fmtDate: this.fmtDate(event.date),
          countdown: this.calcCountdown(event.date, event.timeline),
          raceTypeName: event.raceType === 'full' ? '全程马拉松' : event.raceType === 'half' ? '半程马拉松' : event.raceType === '10k' ? '10公里' : '越野跑',
        },
        reviewStats: stats,
        topTags: tagEntries,
        isMine, myStatus, myReview, isAdmin,
      });
      wx.hideLoading();
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

  calcCountdown(d, timeline) {
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
    if (!d) return '';
    const rd = toDate(d);
    if (isNaN(rd.getTime())) return '';
    const diff = Math.ceil((rd - today) / 86400000);
    if (diff > 0) return `距开赛 ${diff} 天`;
    if (diff === 0) return '今天开赛';
    return `已举办 ${Math.abs(diff)} 天`;
  },

  onWebsite() {
    const url = this.data.event.website;
    if (url) {
      wx.setClipboardData({ data: url });
      wx.showToast({ title: '链接已复制', icon: 'success' });
    }
  },

  onReview() {
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

  async onLoadAllReviews() {
    const res = await wx.cloud.callFunction({ name: 'getRaceReviews', data: { action: 'all', eventId: this.data.eventId } });
    const enriched = [];
    for (const r of (res.result || [])) {
      try {
        const db = require('../../../utils/db').db;
        const u = await db.collection('users').doc(r.userId).get();
        const labels = { difficulty: '难度', atmosphere: '氛围', supply: '补给', transport: '交通', scenery: '风景', org: '组织', medal: '奖牌', value: '性价比' };
        enriched.push({
          ...r,
          userName: u.data ? (u.data.nickName || '未知') : '已删除',
          fmtTime: this.fmtReviewDate(r.createTime),
          fmtScores: Object.keys(r.scores||{}).map(k => `${labels[k]}${r.scores[k]}`).join(' '),
        });
      } catch {}
    }
    this.setData({ allReviews: enriched });
  },

  fmtReviewDate(d) {
    if (!d) return '';
    const dt = new Date(d);
    return `${dt.getMonth()+1}-${dt.getDate()} ${dt.getHours()}:${String(dt.getMinutes()).padStart(2,'0')}`;
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

  async onDelReview(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({ title: '删除评价', content: '确定删除该评价？', confirmColor: '#ff4d4f', success: async (res) => {
      if (!res.confirm) return;
      const db = require('../../../utils/db').db;
      await db.collection('race_reviews').doc(id).remove();
      wx.showToast({ title: '已删除', icon: 'success' });
      this.loadEvent();
    }});
  },
});
