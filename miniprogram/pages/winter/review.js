// pages/winter/review.js - 待审中心：入队申请（队长）+ 打卡审核（队长/教练）
// 注：队长/教练本人打卡免审，由云端自动通过，不会出现在这里
const w = require('../../utils/winter');

Page({
  data: {
    loading: true,
    list: [],               // 待审打卡
    applies: [],            // 待审入队申请（仅队长）
    myRole: '', roleText: '',
    expandedId: '',         // 展开查看详情的打卡 id
    busyId: '', reasonId: '', reason: '',
    applyBusyId: '',
    canReviewApply: false,
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

    const list = await w.resolveAvatars(r.list || []);
    for (const c of list) {
      c.avatarInitial = c.avatarInitial || (c.nickName ? String(c.nickName).charAt(0) : '?');
      c.tempImage = await w.toTempUrl(c.imageFileID);
    }

    // 队长：同时拉取本组待审批入队申请（队员/教练的入队由队长审，不在管理后台）
    let applies = [];
    if (r.myRole === 'leader') {
      const ap = await w.api.leaderApplies().catch(() => null);
      if (ap && ap.ok) {
        applies = await w.resolveAvatars(ap.list || []);
        applies.forEach((m, i) => {
          applies[i].avatarInitial = m.avatarInitial || (m.nickName ? String(m.nickName).charAt(0) : '?');
        });
      }
    }

    this.setData({
      loading: false,
      noPerm: false,
      list,
      applies,
      myRole: r.myRole,
      roleText: w.ROLE_TEXT[r.myRole] || '',
      canReviewApply: r.myRole === 'leader',
    });
  },

  noop() {},

  // ===== 打卡：展开/收起详情 =====
  onToggle(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    this.setData({ expandedId: this.data.expandedId === id ? '' : id });
  },

  onPreview(e) {
    const url = e.currentTarget.dataset.url;
    if (url) wx.previewImage({ urls: [url] });
  },

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

  // ===== 入队申请：标记缴费 / 通过 / 驳回 =====
  async onToggleFee(e) {
    if (this.data.applyBusyId) return;
    const uid = e.currentTarget.dataset.uid;
    const fee = e.currentTarget.dataset.fee;
    const next = fee === 'paid' ? 'unpaid' : 'paid';
    this.setData({ applyBusyId: uid });
    const r = await w.api.setFeeStatus({ userId: uid, feeStatus: next });
    this.setData({ applyBusyId: '' });
    if (!r.ok) return wx.showToast({ title: r.error || '操作失败', icon: 'none' });
    wx.showToast({ title: next === 'paid' ? '已标记：已缴费' : '已标记：未缴费', icon: 'none' });
    this.load();
  },

  async onApplyReview(e) {
    if (this.data.applyBusyId) return;
    const uid = e.currentTarget.dataset.uid;
    const pass = e.currentTarget.dataset.pass === true || e.currentTarget.dataset.pass === 'true';
    if (!pass) {
      wx.showModal({
        title: '驳回申请',
        editable: true,
        placeholderText: '填写驳回原因（选填）',
        success: async (res) => {
          if (!res.confirm) return;
          const r = await w.api.leaderReviewApply({ userId: uid, pass: false, note: res.content || '' });
          if (!r.ok) return wx.showToast({ title: r.error || '操作失败', icon: 'none' });
          wx.showToast({ title: '已驳回', icon: 'none' });
          this.load();
        },
      });
      return;
    }
    this.setData({ applyBusyId: uid });
    const r = await w.api.leaderReviewApply({ userId: uid, pass: true });
    this.setData({ applyBusyId: '' });
    if (!r.ok) {
      return wx.showModal({ title: '无法通过', content: r.error || '操作失败', showCancel: false });
    }
    wx.showToast({ title: '已通过', icon: 'success' });
    this.load();
  },
});
