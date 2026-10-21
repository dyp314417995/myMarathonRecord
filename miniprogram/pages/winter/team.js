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
    // 头像 cloud:// 需转成 https 临时链接，否则 image 组件加载失败
    const members = await w.resolveAvatars(r.members || []);
    const leader = members.find(m => m.role === 'leader') || null;
    const coach = members.find(m => m.role === 'coach') || null;
    this.setData({
      loading: false,
      group: r.group,
      members,
      kpiRange: r.kpiRange,
      me: r.me,
      weekIndex: r.weekIndex,
      frozen: r.frozen,
      leader, coach,
      mates: members.filter(m => m.role === 'member'),
      kpiRangeText: r.kpiRange
        ? `${r.kpiRange.type === 'distance' ? '跑量' : '出勤'} ${r.kpiRange.min} ~ ${r.kpiRange.max}${r.kpiRange.type === 'distance' ? ' 公里/周' : ' 天/周'}${r.kpiRange.minDuration ? (' · 单次≥' + r.kpiRange.minDuration + '分钟') : ''}`
        : '教练尚未设定 KPI 区间',
    });
  },

  onGoKpi() { wx.navigateTo({ url: '/pages/winter/kpi' }); },
  onGoCheckin() { wx.navigateTo({ url: '/pages/winter/checkin' }); },

  // 头像加载失败：置空，改用文字头像兜底
  onAvatarError(e) {
    const k = e.currentTarget.dataset.k;
    if (k === 'mates') {
      const i = Number(e.currentTarget.dataset.i);
      if (this.data.mates[i]) this.setData({ [`mates[${i}].avatarUrl`]: '' });
    } else if (k === 'leader' && this.data.leader) {
      this.setData({ 'leader.avatarUrl': '' });
    } else if (k === 'coach' && this.data.coach) {
      this.setData({ 'coach.avatarUrl': '' });
    }
  },
});
