// pages/tools/calendar/detail.js - 赛事详情
const raceUtil = require('../../../utils/raceEvents');

Page({
  data: {
    eventId: '',
    event: {},
    reviewStats: null,    // { count, avgScore, dimensions, tagStats }
    topTags: [],           // 排序后的标签 top10
    isMine: false,
    myStatus: '',
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
      let isMine = false, myStatus = '';
      if (userInfo) {
        const mkRes = await raceUtil.getMyMarkers(userInfo._id);
        const mine = mkRes.data.find(m => m.eventId === this.data.eventId);
        if (mine) { isMine = true; myStatus = mine.status; }
      }

      this.setData({
        event: {
          ...event,
          fmtDate: this.fmtDate(event.date),
          countdown: this.calcCountdown(event.date),
          raceTypeName: event.raceType === 'full' ? '全程马拉松' : event.raceType === 'half' ? '半程马拉松' : event.raceType === '10k' ? '10公里' : '越野跑',
        },
        reviewStats: stats,
        topTags: tagEntries,
        isMine,
        myStatus,
      });
      wx.hideLoading();
    } catch (err) {
      wx.hideLoading();
    }
  },

  fmtDate(d) {
    const dt = new Date(d);
    return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
  },

  calcCountdown(d) {
    const today = new Date(); today.setHours(0,0,0,0);
    const diff = Math.ceil((new Date(d) - today) / 86400000);
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
    const statuses = ['planned', 'registered', 'won', 'finished', 'dnf', 'dns'];
    const labels = ['计划报名', '已报名', '已中签', '已完赛', '未完赛', '弃赛'];

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
});
