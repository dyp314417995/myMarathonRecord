// pages/winter/rules.js - 破冬行动 · 冬训规则页
const w = require('../../utils/winter');

// intro 提供公开数据（含组别列表），bootstrap 提供登录态数据（含当前周次）
const DEFAULT_CFG = {
  fee: { entry: 50, coach: 30, pool: 20 },
  scale: { target: 100, max: 150 },
  fineTiers: [5, 10, 20], finePackets: 5,
  warnWeek: 1, tailWeek: 15, holidayWeeks: [12, 13],
  totalWeeks: 15,
};

Page({
  data: {
    loading: true,
    intro: '', rulesText: '', phaseText: '', weekIndex: 0,
    totalWeeks: DEFAULT_CFG.totalWeeks,
    fee: DEFAULT_CFG.fee,
    scale: DEFAULT_CFG.scale,
    fineTiers: DEFAULT_CFG.fineTiers,
    finePackets: DEFAULT_CFG.finePackets,
    warnWeek: DEFAULT_CFG.warnWeek,
    tailWeek: DEFAULT_CFG.tailWeek,
    holidayWeeks: DEFAULT_CFG.holidayWeeks,
    groups: [],
  },

  async onLoad() {
    const [introRes, bootRes] = await Promise.all([w.api.intro(), w.api.bootstrap()]);
    const pub = introRes.ok ? introRes : {};
    const priv = bootRes.ok ? bootRes : {};
    const cfg = Object.assign({}, DEFAULT_CFG, pub.cfg || {}, priv.cfg || {});

    this.setData({
      loading: false,
      intro: cfg.intro || '',
      rulesText: cfg.rulesText || '',
      fee: cfg.fee || DEFAULT_CFG.fee,
      scale: cfg.scale || DEFAULT_CFG.scale,
      fineTiers: cfg.fineTiers || DEFAULT_CFG.fineTiers,
      finePackets: cfg.finePackets || DEFAULT_CFG.finePackets,
      warnWeek: cfg.warnWeek || DEFAULT_CFG.warnWeek,
      tailWeek: cfg.tailWeek || DEFAULT_CFG.tailWeek,
      holidayWeeks: cfg.holidayWeeks || DEFAULT_CFG.holidayWeeks,
      totalWeeks: cfg.totalWeeks || DEFAULT_CFG.totalWeeks,
      groups: pub.groups || [],
      phaseText: w.PHASE_TEXT[cfg.phase] || '',
      weekIndex: priv.weekIndex || 0,
    });
  },

  onPullDownRefresh() {
    this.onLoad().then(() => wx.stopPullDownRefresh());
  },
});
