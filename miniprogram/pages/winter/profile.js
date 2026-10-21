// pages/winter/profile.js - 我的冬训档案（KPI / 连续未完成 / 罚金 / 费用 / 周历史）
const w = require('../../utils/winter');

Page({
  data: {
    loading: true, me: null, fee: {}, totalFee: 0, weekIndex: 0,
    fines: [], weekly: [],
  },

  async onShow() { await this.load(); },
  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },

  async load() {
    const r = await w.api.myProfile();
    if (!r.ok) {
      wx.showToast({ title: r.error || '加载失败', icon: 'none' });
      this.setData({ loading: false, notJoined: true });
      return;
    }
    this.setData({
      loading: false, me: r.me, fee: r.fee, totalFee: r.totalFee,
      weekIndex: r.weekIndex, fines: r.fines, weekly: r.weekly,
    });
  },

  onGoKpi() { wx.navigateTo({ url: '/pages/winter/kpi' }); },
});
