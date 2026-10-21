// pages/winter/schedule.js - 周课表（教练发布 / 队员查看+反馈）
const w = require('../../../utils/winter');

Page({
  data: {
    loading: true, weekIndex: 0, schedule: null,
    isCoach: false, editing: false,
    form: { a: '', b: '', c: '', advice: '' },
    feedback: '',
  },

  async onShow() { await this.load(); },
  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },

  async load() {
    const my = await w.api.myGroup();
    const r = await w.api.getSchedule({});
    const isCoach = my.ok && my.me.role === 'coach';
    if (!r.ok) {
      wx.showToast({ title: r.error || '加载失败', icon: 'none' });
      this.setData({ loading: false });
      return;
    }
    const s = r.schedule;
    this.setData({
      loading: false,
      weekIndex: r.weekIndex,
      schedule: s,
      isCoach,
      form: s ? { a: s.a || '', b: s.b || '', c: s.c || '', advice: s.advice || '' } : { a: '', b: '', c: '', advice: '' },
    });
    // 队员自动标记已读
    if (s && !s.read && !isCoach) {
      await w.api.readSchedule({ id: s._id });
    }
  },

  onEdit() { this.setData({ editing: true }); },
  onCancelEdit() { this.setData({ editing: false }); },
  onFormInput(e) {
    const f = e.currentTarget.dataset.f;
    this.setData({ ['form.' + f]: e.detail.value });
  },

  async onPublish() {
    const f = this.data.form;
    if (!f.a && !f.b && !f.c) return wx.showToast({ title: '请至少填写一档内容', icon: 'none' });
    wx.showLoading({ title: '发布中' });
    const r = await w.api.publishSchedule({
      tiers: [{ content: f.a }, { content: f.b }, { content: f.c }],
      advice: f.advice,
    });
    wx.hideLoading();
    if (!r.ok) return wx.showToast({ title: r.error || '发布失败', icon: 'none' });
    wx.showToast({ title: '课表已发布', icon: 'success' });
    this.setData({ editing: false });
    this.load();
  },

  onFeedback(e) {
    const v = e.currentTarget.dataset.v;
    const text = { done: '已完成', downgrade: '需降档', skip: '跳过本周' }[v] || '';
    this.setData({ feedback: v });
    wx.showToast({ title: '已标记：' + text, icon: 'none' });
  },
});
