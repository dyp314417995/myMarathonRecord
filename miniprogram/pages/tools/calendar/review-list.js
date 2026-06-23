// pages/tools/calendar/review-list.js - 评分详情
const raceUtil = require('../../../utils/raceEvents');

Page({
  data: {
    eventId: '',
    eventName: '',
    stats: null,         // { count, avgScore, dimensions, tagStats }
    topTags: [],
    dimLabels: {
      difficulty: '赛道难度', atmosphere: '赛道氛围', supply: '补给',
      transport: '交通', scenery: '赛道风景', org: '组织水平',
      medal: '完赛奖牌', value: '性价比'
    },
  },

  async onLoad(options) {
    if (!options.id) return;
    this.setData({ eventId: options.id, eventName: options.name || '' });
    await this.loadStats();
  },

  async loadStats() {
    wx.showLoading({ title: '加载中' });
    try {
      const stats = await raceUtil.getReviewStats(this.data.eventId);
      const topTags = Object.entries(stats.tagStats || {})
        .sort((a, b) => b[1] - a[1]).slice(0, 10);
      this.setData({ stats, topTags });
    } catch (err) {}
    wx.hideLoading();
  },
});
