// pages/winter/kpi.js - KPI 填报（队员）/ 区间设定（教练）
const w = require('../../../utils/winter');

Page({
  data: {
    loading: true, role: '', isCoach: false,
    kpiRange: null, rangeText: '',
    kpiType: '', kpiValue: '', inRange: true, myKpiValue: 0,
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
    const range = r.kpiRange;
    const isCoach = r.me.role === 'coach';
    this.setData({
      loading: false,
      role: r.me.role,
      roleText: w.ROLE_TEXT[r.me.role] || '',
      isCoach,
      kpiRange: range,
      kpiType: range ? range.type : '',
      myKpiValue: r.me.kpiValue || 0,
      kpiValue: r.me.kpiValue ? String(r.me.kpiValue) : '',
      rangeText: range
        ? `${range.type === 'distance' ? '跑量' : '出勤'} ${range.min} ~ ${range.max}${range.type === 'distance' ? ' 公里/周' : ' 天/周'}`
        : '教练尚未设定 KPI 区间',
      unit: range && range.type === 'attendance' ? '天/周' : '公里/周',
      'form.type': range ? range.type : 'distance',
      'form.min': range ? String(range.min) : '',
      'form.max': range ? String(range.max) : '',
      'form.minDuration': range && range.minDuration ? String(range.minDuration) : '',
    });
    if (r.me.kpiValue) this.checkRange(String(r.me.kpiValue));
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
      type: f.type, min, max, minDuration: isNaN(minDuration) ? 0 : minDuration,
    });
    this.setData({ submitting: false });
    if (!r.ok) return wx.showToast({ title: r.error || '保存失败', icon: 'none' });
    wx.showToast({ title: '区间已生效', icon: 'success' });
    this.load();
  },

  onPickType(e) { this.setData({ 'form.type': e.currentTarget.dataset.v }); },
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
    wx.showToast({ title: 'KPI 已保存（区间内自动通过）', icon: 'success' });
    setTimeout(() => wx.navigateBack(), 1200);
  },
});
