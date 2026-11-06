// pages/winter/schedule.js - 周课表（教练发布 / 队员查看+反馈）
const w = require('../../utils/winter');

Page({
  data: {
    loading: true, weekIndex: 0, schedule: null,
    isCoach: false, editing: false,
    // 兼任教练：可管理的组（主组 + 挂职组），发布前先选组
    coachOptions: [], coachGid: '', coachGName: '',
    form: { a: '', b: '', c: '', advice: '' },
    feedback: '',
  },

  async onShow() { await this.load(); },
  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },

  async load() {
    const my = await w.api.myGroup();
    if (!my.ok) {
      wx.showToast({ title: my.error || '加载失败', icon: 'none' });
      this.setData({ loading: false });
      return;
    }
    // 可管理的组：主记录是教练 → 主组；另有兼任教练的组 → 逐个可选
    const options = [];
    if (my.me.role === 'coach') options.push({ gid: '', name: (my.group && my.group.name) || '我的组' });
    ((my.staffRoles) || []).filter(s => s.role === 'coach').forEach(s => options.push({ gid: s.groupId, name: s.groupName }));
    const isCoach = options.length > 0;
    // 保持当前选择；无效或首次进入则落到第一项
    let sel = this.data.coachOptions.find(o => o.gid === this.data.coachGid) || options[0] || { gid: '', name: '' };
    const r = await w.api.getSchedule({ groupId: sel.gid });
    if (!r.ok) {
      wx.showToast({ title: r.error || '加载失败', icon: 'none' });
      this.setData({ loading: false, isCoach, coachOptions: options, coachGid: sel.gid, coachGName: sel.name });
      return;
    }
    const s = r.schedule;
    this.setData({
      loading: false,
      weekIndex: r.weekIndex,
      schedule: s,
      isCoach,
      coachOptions: options, coachGid: sel.gid, coachGName: sel.name,
      form: s ? { a: s.a || '', b: s.b || '', c: s.c || '', advice: s.advice || '' } : { a: '', b: '', c: '', advice: '' },
    });
    // 队员自动标记已读（兼任教练看挂职组课表不标已读）
    if (s && !s.read && !isCoach) {
      await w.api.readSchedule({ id: s._id });
    }
  },

  onSelectCoachGroup(e) {
    const gid = e.currentTarget.dataset.gid || '';
    if (gid === this.data.coachGid) return;
    this.setData({ loading: true, editing: false, coachGid: gid }, () => this.load());
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
      groupId: this.data.coachGid,
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
