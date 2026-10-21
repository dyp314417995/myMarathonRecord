// pages/winter/rank.js - 榜单（队伍人均完成率 + 个人完成率）
const w = require('../../utils/winter');

Page({
  data: {
    loading: true, weekIndex: 0, frozen: false, frozenText: '',
    teamRank: [], personal: [], myStat: null, groupAvgRate: 0, completedCount: 0,
    tab: 'team',
  },

  async onShow() { await this.load(); },
  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },

  onTab(e) { this.setData({ tab: e.currentTarget.dataset.v }); },

  async load() {
    const r = await w.api.weeklyStats({});
    if (!r.ok) {
      wx.showToast({ title: r.error || '加载失败', icon: 'none' });
      this.setData({ loading: false });
      return;
    }
    this.setData({
      loading: false,
      weekIndex: r.weekIndex, frozen: r.frozen,
      frozenText: w.FROZEN_TEXT[r.frozenReason] || (r.frozen ? '本周不考核，打卡照常开放' : ''),
      teamRank: r.teamRank || [], personal: r.personal || [],
      myStat: r.myStat, groupAvgRate: r.groupAvgRate, completedCount: r.completedCount,
    });
  },
});
