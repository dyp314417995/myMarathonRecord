// pages/points/admin.js - 积分管理后台
const pointsUtil = require('../../utils/points');
const dbUtil = require('../../utils/db');

Page({
  data: {
    tab: 'rules',       // rules | review | record | deduct
    rules: [],
    pendingList: [],
    users: [],
    // 写入/扣减表单
    selectedUserId: '',
    selectedUserName: '',
    deductPoints: '',
    deductReason: '',
    deductCat: '消耗',
    showUserPicker: false,
    userFilter: '',
  },

  async onShow() {
    await Promise.all([this.loadRules(), this.loadPending(), this.loadUsers()]);
  },

  onTabChange(e) {
    this.setData({ tab: e.currentTarget.dataset.tab });
    if (e.currentTarget.dataset.tab === 'review') this.loadPending();
  },

  // ========== 规则 ==========
  async loadRules() {
    const res = await pointsUtil.getRules();
    this.setData({ rules: res.data });
  },

  async onToggleRuleStatus(e) {
    const { id, status } = e.currentTarget.dataset;
    const newStatus = status === 'active' ? 'disabled' : 'active';
    await pointsUtil.updateRule(id, { status: newStatus });
    this.loadRules();
  },

  // ========== 审批 ==========
  async loadPending() {
    const res = await pointsUtil.getPendingRecords();
    const enriched = await Promise.all(res.data.map(async (r) => {
      try {
        const u = await dbUtil.db.collection('users').doc(r.userId).get();
        // 转换图片为临时 URL
        let imgUrls = [];
        if (r.images && r.images.length > 0) {
          const urlRes = await wx.cloud.getTempFileURL({ fileList: r.images });
          imgUrls = urlRes.fileList.map(f => f.tempFileURL);
        }
        return { ...r, userName: u.data.nickName || '未知', images: imgUrls };
      } catch { return r; }
    }));
    this.setData({ pendingList: enriched });
  },

  async onApprove(e) {
    const { id } = e.currentTarget.dataset;
    await pointsUtil.reviewRecord(id, 'approved', '');
    wx.showToast({ title: '已通过', icon: 'success' });
    this.loadPending();
  },

  async onReject(e) {
    const { id } = e.currentTarget.dataset;
    await pointsUtil.reviewRecord(id, 'rejected', '');
    wx.showToast({ title: '已拒绝', icon: 'success' });
    this.loadPending();
  },

  // ========== 手动录入/扣减 ==========
  async loadUsers() {
    const res = await dbUtil.getUserList();
    this.setData({ allUsers: res.data });
  },

  onSearchUser(e) {
    const kw = e.detail.value;
    const filteredUsers = kw
      ? (this.data.allUsers || []).filter(u => (u.nickName || '').indexOf(kw) >= 0)
      : (this.data.allUsers || []);
    this.setData({ userFilter: kw, filteredUsers, showUserPicker: true });
  },

  showUserPicker() {
    this.setData({ showUserPicker: true, filteredUsers: this.data.allUsers || [] });
  },

  onSelectUser(e) {
    const { id, name } = e.currentTarget.dataset;
    this.setData({ selectedUserId: id, selectedUserName: name, showUserPicker: false });
  },

  hideUserPicker() { this.setData({ showUserPicker: false }); },

  async onSubmitDeduct() {
    const { selectedUserId, deductPoints, deductReason, deductCat } = this.data;
    if (!selectedUserId) return wx.showToast({ title: '请选择用户', icon: 'none' });
    const pts = parseInt(deductPoints);
    if (!pts || pts === 0) return wx.showToast({ title: '请输入积分数量', icon: 'none' });
    if (!deductReason.trim()) return wx.showToast({ title: '请输入原因', icon: 'none' });

    // 获取当前余额
    const balance = await pointsUtil.getBalance(selectedUserId);
    if (pts > 0 && balance < pts) return wx.showToast({ title: '余额不足', icon: 'none' });

    try {
      await pointsUtil.addRecord({
        userId: selectedUserId,
        type: pts > 0 ? 'use' : 'earn',
        category: pts > 0 ? deductCat : '集体活动',
        points: pts > 0 ? -pts : Math.abs(pts),
        description: deductReason,
        images: [],
        earnDate: new Date(),
        expireDate: new Date(Date.now() + 365 * 86400000),
        status: 'approved',
      });
      wx.showToast({ title: '操作成功', icon: 'success' });
      this.setData({ deductPoints: '', deductReason: '' });
    } catch (err) {
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  onPointsInput(e) { this.setData({ deductPoints: e.detail.value }); },
  onReasonInput(e) { this.setData({ deductReason: e.detail.value }); },
});
