// pages/winter/kpi.js - KPI 填报（队员）/ 区间设定（教练）
const w = require('../../utils/winter');

Page({
  data: {
    loading: true, role: '', isCoach: false,
    kpiRange: null, rangeText: '',
    kpiType: '', kpiValue: '', inRange: true, myKpiValue: 0,
    weekIndex: 0, kpiHistory: [],   // 周 KPI：当前周次 + 历史记录
    // 教练表单
    form: { type: 'distance', min: '', max: '', minDuration: '' },
    submitting: false,
  },

  async onShow() {
    await this.load();
  },

  async load() {
    const r = await w.api.myGroup();
    if (!r.ok) {
      wx.showToast({ title: r.error || '加载失败', icon: 'none' });
      this.setData({ loading: false });
      return;
    }
    const range = r.kpiRange;   // 主组区间：本人 KPI 填报按主组考核，不随兼任组变
    // 可管理的组：主记录是教练 → 主组；另有兼任教练的组 → 逐个可选
    const options = [];
    if (r.me.role === 'coach') options.push({ gid: '', name: (r.group && r.group.name) || '我的组', kpiRange: range, suggest: (r.group && r.group.suggest) || null });
    ((r.staffRoles) || []).filter(s => s.role === 'coach').forEach(s => options.push({ gid: s.groupId, name: s.groupName, kpiRange: s.kpiRange || null, suggest: s.suggest || null }));
    const isCoach = options.length > 0;
    // 区间编辑器针对所选组；保持当前选择，无效或首次进入则落到第一项
    const sel = (this.data.coachOptions.find(o => o.gid === this.data.coachGid && options.some(x => x.gid === o.gid))) || options[0] || null;
    const coachGid = sel ? sel.gid : '';
    const coachGName = sel ? sel.name : '';
    const coachRange = sel ? sel.kpiRange : null;
    // 教练未发布过区间时，用该组的能力档位「建议区间」作初始值（规则：开营前公示，教练可调整后发布）
    const sug = sel ? sel.suggest : null;
    const seed = coachRange || (sug ? {
      type: sug.defaultType || (sug.distance ? 'distance' : 'attendance'),
      min: sug.distance ? sug.distance.min : sug.attendance.min,
      max: sug.distance ? sug.distance.max : sug.attendance.max,
      minDuration: sug.minDuration || 20,
    } : null);
    const isDraft = !coachRange && !!seed; // 尚未发布，仅为参考初值
    const weekIndex = r.weekIndex || 0;
    const hist = r.kpiHistory || [];
    // 本周已填 → 用本周值；新的一周还没填 → 预填上周目标（不填则自动沿用）
    const isThisWeek = r.me.kpiWeek === weekIndex;
    const seedValue = (isThisWeek && r.me.kpiValue)
      ? r.me.kpiValue
      : (hist[0] ? hist[0].value : 0);
    this.setData({
      loading: false,
      role: r.me.role,
      roleText: w.ROLE_TEXT[r.me.role] || '',
      isCoach,
      isDraft,
      draftTip: isDraft ? '当前为本组建议参考区间，确认后点击「发布区间」正式生效' : '',
      coachOptions: options, coachGid, coachGName,
      kpiRange: range,
      kpiType: range ? range.type : '',
      weekIndex,
      kpiHistory: hist,
      myKpiValue: isThisWeek ? (r.me.kpiValue || 0) : 0,
      kpiLocked: !!r.me.kpiLocked,   // 本周已打卡才锁定，新的一周自动解锁
      kpiValue: seedValue ? String(seedValue) : '',
      rangeText: coachRange
        ? `${coachRange.type === 'distance' ? '跑量' : '出勤'} ${coachRange.min} ~ ${coachRange.max}${coachRange.type === 'distance' ? ' 公里/周' : ' 天/周'}`
        : '教练尚未设定 KPI 区间',
      unit: range && range.type === 'attendance' ? '天/周' : '公里/周',
      'form.type': seed ? seed.type : 'distance',
      'form.min': seed ? String(seed.min) : '',
      'form.max': seed ? String(seed.max) : '',
      'form.minDuration': seed && seed.minDuration ? String(seed.minDuration) : '20',
    });
    if (seedValue) this.checkRange(String(seedValue));
  },

  checkRange(val) {
    const range = this.data.kpiRange;
    if (!range) { this.setData({ inRange: false }); return; }
    const n = Number(val);
    const valid = !isNaN(n) && n >= range.min && n <= range.max;
    this.setData({ inRange: valid });
  },

  onInputValue(e) {
    const v = e.detail.value;
    this.setData({ kpiValue: v });
    this.checkRange(v);
  },

  async onSaveRange() {
    const f = this.data.form;
    const min = Number(f.min), max = Number(f.max), minDuration = Number(f.minDuration);
    if (!min || !max) return wx.showToast({ title: '请填写上下限', icon: 'none' });
    if (max < min) return wx.showToast({ title: '上限不能小于下限', icon: 'none' });
    this.setData({ submitting: true });
    const r = await w.api.setKpiRange({
      groupId: this.data.coachGid,
      type: f.type, min, max, minDuration: isNaN(minDuration) ? 0 : minDuration,
    });
    this.setData({ submitting: false });
    if (!r.ok) return wx.showToast({ title: r.error || '保存失败', icon: 'none' });
    wx.showToast({ title: '区间已生效', icon: 'success' });
    this.load();
  },

  onPickType(e) { this.setData({ 'form.type': e.currentTarget.dataset.v }); },

  onSelectCoachGroup(e) {
    const gid = e.currentTarget.dataset.gid || '';
    if (gid === this.data.coachGid) return;
    this.setData({ loading: true, coachGid: gid }, () => this.load());
  },
  onFormInput(e) {
    const f = e.currentTarget.dataset.f;
    this.setData({ ['form.' + f]: e.detail.value });
  },

  async onSubmitKpi() {
    const v = this.data.kpiValue;
    if (!this.data.inRange) return wx.showToast({ title: 'KPI 需在区间内', icon: 'none' });
    this.setData({ submitting: true });
    const r = await w.api.submitKpi({ kpiType: this.data.kpiType, kpiValue: Number(v) });
    this.setData({ submitting: false });
    if (!r.ok) return wx.showToast({ title: r.error || '提交失败', icon: 'none' });
    wx.showToast({ title: `第 ${r.weekIndex || this.data.weekIndex} 周目标已保存`, icon: 'success' });
    this.load(); // 刷新以显示锁定状态与历史记录
  },
});
