// pages/winter/index.js - 冬训营首页（未报名：介绍+报名；已报名：我的概览）
const w = require('../../utils/winter');

Page({
  data: {
    loading: true,
    phase: '', phaseText: '', weekIndex: 0, frozen: false, frozenText: '',
    joined: false,
    member: null, group: null, kpiRange: null, todayCheckin: null, pendingCount: 0,
    cfg: {}, isAdmin: false,
    myRoleText: '', statusText: '',
    weeklyAvg: '--',
    groups: [], scale: { target: 100, max: 150 },
  },

  onLoad() {
    // 未报名时也需要介绍数据
  },

  async onShow() {
    await this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  async load() {
    this.setData({ loading: true });
    // bootstrap 提供登录态数据，intro 提供公开的组别列表与规模（未报名用户也要看到）
    const [r, introRes] = await Promise.all([w.api.bootstrap(), w.api.intro()]);
    if (introRes.ok) {
      this.setData({
        groups: introRes.groups || [],
        scale: (introRes.cfg && introRes.cfg.scale) || { target: 100, max: 150 },
      });
    }
    if (!r.ok) {
      this.setData({ loading: false });
      if (/登录/.test(r.error || '')) {
        wx.showModal({
          title: '需要登录', content: '请先登录后再进入冬训营',
          success: (res) => { if (res.confirm) wx.navigateTo({ url: '/pages/login/login' }); },
        });
      } else {
        wx.showToast({ title: r.error || '加载失败', icon: 'none' });
      }
      return;
    }
    const kpiRange = r.kpiRange;
    let myRoleText = '';
    if (r.member) myRoleText = w.ROLE_TEXT[r.member.role] || '';
    this.setData({
      loading: false,
      phase: r.cfg.phase,
      phaseText: w.PHASE_TEXT[r.cfg.phase] || '',
      weekIndex: r.weekIndex,
      frozen: r.frozen,
      frozenText: w.FROZEN_TEXT[r.frozenReason] || (r.frozen ? '本周不考核，打卡照常开放' : ''),
      joined: r.joined,
      member: r.member,
      group: r.group,
      kpiRange,
      kpiRangeText: kpiRange ? `${kpiRange.type === 'distance' ? '跑量' : '出勤'} ${kpiRange.min} ~ ${kpiRange.max}${kpiRange.type === 'distance' ? ' 公里/周' : ' 天/周'}` : '教练尚未设定',
      todayCheckin: r.todayCheckin,
      todayCheckinText: r.todayCheckin ? this.statusText(r.todayCheckin.status) : '未打卡',
      pendingCount: r.pendingCount,
      cfg: r.cfg,
      isAdmin: r.isAdmin,
      myRoleText,
      statusText: r.member ? (w.STATUS_TEXT[r.member.status] || r.member.status) : '',
    });
    if (r.joined) this.loadWeekRate();
  },

  async loadWeekRate() {
    const r = await w.api.weeklyStats({});
    if (r.ok) this.setData({ weeklyAvg: `${r.groupAvgRate}%` });
  },

  statusText(s) {
    return { pending: '审核中', approved: '已通过', rejected: '已驳回' }[s] || s || '';
  },

  onGoApply() { wx.navigateTo({ url: '/pages/winter/apply' }); },
  onGoTeam() { wx.navigateTo({ url: '/pages/winter/team' }); },
  onGoKpi() { wx.navigateTo({ url: '/pages/winter/kpi' }); },
  onGoCheckin() { wx.navigateTo({ url: '/pages/winter/checkin' }); },
  onGoReview() { wx.navigateTo({ url: '/pages/winter/review' }); },
  onGoRank() { wx.navigateTo({ url: '/pages/winter/rank' }); },
  onGoSchedule() { wx.navigateTo({ url: '/pages/winter/schedule' }); },
  onGoProfile() { wx.navigateTo({ url: '/pages/winter/profile' }); },
  onGoRules() { wx.navigateTo({ url: '/pages/winter/rules' }); },
  onGoAdmin() { wx.navigateTo({ url: '/pages/winter/admin' }); },
});
