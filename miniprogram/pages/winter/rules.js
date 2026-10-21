// pages/winter/rules.js - 冬训规则页
const w = require('../../utils/winter');

Page({
  data: {
    loading: true, intro: '', fee: {}, weekIndex: 0, totalWeeks: 12, phaseText: '',
  },

  async onLoad() {
    const r = await w.api.intro();
    if (r.ok) {
      this.setData({
        loading: false, intro: r.cfg.intro || '', fee: r.cfg.fee || {},
        rulesText: r.cfg.rulesText || '', totalWeeks: r.cfg.totalWeeks || 12,
        phaseText: w.PHASE_TEXT[r.cfg.phase] || '',
      });
    } else {
      const b = await w.api.bootstrap();
      this.setData({
        loading: false,
        intro: b.ok ? (b.cfg.intro || '') : '', fee: b.ok ? (b.cfg.fee || {}) : {},
        rulesText: b.ok ? (b.cfg.rulesText || '') : '', totalWeeks: b.ok ? (b.cfg.totalWeeks || 12) : 12,
        phaseText: b.ok ? (w.PHASE_TEXT[b.cfg.phase] || '') : '',
      });
    }
  },
});
