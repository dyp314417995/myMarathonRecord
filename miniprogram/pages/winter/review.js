// pages/winter/review.js - 审核中心：待审（入队申请 + 打卡）+ 已审（组内打卡记录）
// 注：队长/教练本人打卡免审，由云端自动通过，不会出现在待审里；队员进来只看「已审」
const w = require('../../utils/winter');

Page({
  data: {
    loading: true,
    tab: 'pending',         // pending=待审 / reviewed=已审
    list: [],               // 待审打卡（仅队长/教练）
    reviewed: [],           // 本组已审打卡（全员可看）
    leaves: [],             // 待审请假（仅队长/教练）
    applies: [],            // 待审入队申请（仅队长）
    myRole: '', roleText: '', canReview: false,
    expandedId: '',         // 展开查看详情的记录 id（待审 / 已审共用一套展开态）
    busyId: '', reasonId: '', reason: '',
    applyBusyId: '',
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

    const canReview = !!r.canReview;
    const list = await w.resolveAvatars(r.list || []);
    const reviewed = await w.resolveAvatars(r.reviewed || []);
    const leaves = await w.resolveAvatars(r.leaves || []);
    const initial = (c) => { c.avatarInitial = c.avatarInitial || (c.nickName ? String(c.nickName).charAt(0) : '?'); };
    list.forEach(initial);
    reviewed.forEach(initial);
    leaves.forEach(initial);

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

    // 没审核权限（队员）就直接落在「已审」，别停在空的待审页
    const tab = canReview ? (this.data.tab || 'pending') : 'reviewed';
    this.setData({
      loading: false, noPerm: false,
      list, reviewed, leaves, applies, tab,
      myRole: r.myRole, roleText: w.ROLE_TEXT[r.myRole] || '',
      canReview,
    });
  },

  onTab(e) { this.setData({ tab: e.currentTarget.dataset.v, expandedId: '' }); },

  noop() {},

  // 图片：列表加载时不转（上百条记录要把云函数打爆），展开这条时才转
  async loadImages(key, id) {
    const i = this.data[key].findIndex(x => x._id === id);
    if (i < 0) return;
    const c = this.data[key][i];
    if (c.tempImages) return;
    const ids = (c.imageFileIDs && c.imageFileIDs.length) ? c.imageFileIDs : (c.imageFileID ? [c.imageFileID] : []);
    const urls = [];
    for (const fid of ids) {
      const u = await w.toTempUrl(fid);
      if (u) urls.push(u);
    }
    this.setData({ [`${key}[${i}].tempImages`]: urls });
  },

  async onToggle(e) {
    const { id, key } = e.currentTarget.dataset;
    if (!id) return;
    const next = this.data.expandedId === id ? '' : id;
    this.setData({ expandedId: next });
    if (next) await this.loadImages(key || 'list', id);
  },

  onPreview(e) {
    const { key, id, url } = e.currentTarget.dataset;
    const c = (this.data[key] || []).find(x => x._id === id);
    const urls = (c && c.tempImages) || [];
    if (!urls.length) return;
    wx.previewImage({ urls, current: url || urls[0] });
  },

  onAvatarError(e) {
    const { key, i } = e.currentTarget.dataset;
    const idx = Number(i);
    if (this.data[key] && this.data[key][idx]) this.setData({ [`${key}[${idx}].avatarUrl`]: '' });
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

  // ===== 请假审批 =====
  async onPassLeave(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ busyId: id });
    const r = await w.api.reviewLeave({ id, pass: true });
    this.setData({ busyId: '' });
    if (!r.ok) return wx.showToast({ title: r.error || '操作失败', icon: 'none' });
    wx.showToast({ title: '已批准', icon: 'success' });
    this.load();
  },
  async onRejectLeave(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '驳回请假',
      editable: true,
      placeholderText: '填写驳回原因',
      success: async (res) => {
        if (!res.confirm) return;
        this.setData({ busyId: id });
        const r = await w.api.reviewLeave({ id, pass: false, note: res.content || '' });
        this.setData({ busyId: '' });
        if (!r.ok) return wx.showToast({ title: r.error || '操作失败', icon: 'none' });
        wx.showToast({ title: '已驳回', icon: 'none' });
        this.load();
      },
    });
  },

  onAskReject(e) { this.setData({ reasonId: e.currentTarget.dataset.id, reason: '' }); },
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
    const next = fee === 'paid' ? 'free' : (fee === 'free' ? 'unpaid' : 'paid');
    this.setData({ applyBusyId: uid });
    const r = await w.api.setFeeStatus({ userId: uid, feeStatus: next });
    this.setData({ applyBusyId: '' });
    if (!r.ok) return wx.showToast({ title: r.error || '操作失败', icon: 'none' });
    const txt = next === 'paid' ? '已缴费' : (next === 'free' ? '免费（无需缴费）' : '未缴费');
    wx.showToast({ title: '已标记：' + txt, icon: 'none' });
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
