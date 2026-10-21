// pages/winter/team.js - 我的组（名单 + KPI 区间）
const w = require('../../utils/winter');

Page({
  data: {
    loading: true, group: null, members: [], kpiRange: null, me: {},
    weekIndex: 0, frozen: false,
    leader: null, coach: null, mates: [],
  },

  async onShow() {
    await this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  async load() {
    const r = await w.api.myGroup();
    if (!r.ok) {
      wx.showToast({ title: r.error || '加载失败', icon: 'none' });
      this.setData({ loading: false });
      return;
    }
    const leader = (r.members || []).find(m => m.role === 'leader') || null;
    const coach = (r.members || []).find(m => m.role === 'coach') || null;
    this.setData({
      loading: false,
      group: r.group,
      members: r.members,
      kpiRange: r.kpiRange,
      me: r.me,
      weekIndex: r.weekIndex,
      frozen: r.frozen,
      leader, coach,
      mates: (r.members || []).filter(m => m.role === 'member'),
      kpiRangeText: r.kpiRange
        ? `${r.kpiRange.type === 'distance' ? '跑量' : '出勤'} ${r.kpiRange.min} ~ ${r.kpiRange.max}${r.kpiRange.type === 'distance' ? ' 公里/周' : ' 天/周'}${r.kpiRange.minDuration ? (' · 单次≥' + r.kpiRange.minDuration + '分钟') : ''}`
        : '教练尚未设定 KPI 区间',
    });
  },

  onGoKpi() { wx.navigateTo({ url: '/pages/winter/kpi' }); },
  onGoCheckin() { wx.navigateTo({ url: '/pages/winter/checkin' }); },
});
