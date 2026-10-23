// pages/winter/rank.js - 榜单（队伍人均完成率 + 个人完成率）
const w = require('../../utils/winter');

Page({
  data: {
    loading: true, weekIndex: 0, frozen: false, frozenText: '',
    teamRank: [], personal: [], myStat: null, groupAvgRate: 0, completedCount: 0,
    tab: 'personal',   // 个人榜在前（大家更关心自己的完成情况）
  },

  async onShow() { await this.load(); },
  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },

  onTab(e) { this.setData({ tab: e.currentTarget.dataset.v }); },

  // 头像加载失败（临时链接过期/文件缺失）：置空，改用文字头像兜底
  onAvatarError(e) {
    const i = Number(e.currentTarget.dataset.i);
    if (this.data.personal[i]) this.setData({ [`personal[${i}].avatarUrl`]: '' });
  },

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
      teamRank: r.teamRank || [], personal: await w.resolveAvatars(r.personal || []),
      myStat: r.myStat, groupAvgRate: r.groupAvgRate, completedCount: r.completedCount,
    });
  },
});
