// pages/winter/review.js - 队长/教练审核本组打卡（互审）
const w = require('../../utils/winter');

Page({
  data: {
    loading: true, list: [], myRole: '', busyId: '', reasonId: '', reason: '',
  },

  async onShow() {
    await this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  async load() {
    const r = await w.api.pendingReview();
    if (!r.ok) {
      wx.showToast({ title: r.error || '加载失败', icon: 'none' });
      this.setData({ loading: false, noPerm: true, errMsg: r.error });
      return;
    }
    // 加载图片临时链接；头像同样要把 cloud:// 转成 https（image 组件不支持 cloud://）
    const list = await w.resolveAvatars(r.list || []);
    for (const c of list) {
      c.tempImage = await w.toTempUrl(c.imageFileID);
    }
    this.setData({
      loading: false, list, myRole: r.myRole,
      roleText: w.ROLE_TEXT[r.myRole] || '',
    });
  },

  onPreview(e) {
    const url = e.currentTarget.dataset.url;
    if (url) wx.previewImage({ urls: [url] });
  },

  // 头像加载失败：置空，改用文字头像兜底
  onAvatarError(e) {
    const i = Number(e.currentTarget.dataset.i);
    if (this.data.list[i]) this.setData({ [`list[${i}].avatarUrl`]: '' });
  },

  async doReview(id, pass, note) {
    this.setData({ busyId: id });
    const r = await w.api.reviewCheckin({ id, pass, note: note || '' });
    this.setData({ busyId: '', reasonId: '', reason: '' });
    if (!r.ok) {
      wx.showToast({ title: r.error || '操作失败', icon: 'none' });
      return;
    }
    wx.showToast({ title: pass ? '已通过' : '已驳回', icon: 'success' });
    this.load();
  },

  onPass(e) { this.doReview(e.currentTarget.dataset.id, true); },

  onAskReject(e) {
    this.setData({ reasonId: e.currentTarget.dataset.id, reason: '' });
  },
  onCancelReject() { this.setData({ reasonId: '', reason: '' }); },
  onReasonInput(e) { this.setData({ reason: e.detail.value }); },
  onConfirmReject(e) {
    const id = e.currentTarget.dataset.id;
    const reason = (this.data.reason || '').trim();
    if (!reason) return wx.showToast({ title: '请填写驳回原因', icon: 'none' });
    this.doReview(id, false, reason);
  },
});
