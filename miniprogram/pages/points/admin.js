// pages/points/admin.js - 积分管理后台
const pointsUtil = require('../../utils/points');
const dbUtil = require('../../utils/db');

Page({
  data: {
    isSuperAdmin: false,
    isAdmin: false,
    tab: 'rules',
    rules: [],
    pendingList: [],
    users: [],
    selectedUserId: '',
    selectedUserName: '',
    deductPoints: '',
    deductReason: '',
    showUserPicker: false,
    userFilter: '',
  },

  async onShow() {
    const userInfo = wx.getStorageSync('userInfo') || {};
    this.setData({
      isSuperAdmin: userInfo.role === 'super_admin',
      isAdmin: userInfo.role === 'super_admin' || userInfo.role === 'admin',
    });
    await pointsUtil.initDefaultRules();
    await Promise.all([this.loadRules(), this.loadPending(), this.loadUsers()]);
  },

  onTabChange(e) {
    this.setData({ tab: e.currentTarget.dataset.tab });
    if (e.currentTarget.dataset.tab === 'review') this.loadPending();
  },

  onGoApply() {
    wx.navigateTo({ url: '/pages/points/apply' });
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
    const { selectedUserId, deductPoints, deductReason } = this.data;
    if (!selectedUserId) return wx.showToast({ title: '请选择用户', icon: 'none' });
    const pts = parseInt(deductPoints);
    if (isNaN(pts) || pts === 0) return wx.showToast({ title: '请输入积分数量', icon: 'none' });
    if (!deductReason.trim()) return wx.showToast({ title: '请输入原因', icon: 'none' });

    // 扣减时检查余额
    if (pts < 0) {
      const balance = await pointsUtil.getBalance(selectedUserId);
      if (balance < Math.abs(pts)) return wx.showToast({ title: '余额不足', icon: 'none' });
    }

    // 正数=加积分，负数=扣积分
    const isEarn = pts > 0;
    try {
      await pointsUtil.addRecord({
        userId: selectedUserId,
        type: isEarn ? 'earn' : 'use',
        category: isEarn ? '集体活动' : '消耗',
        points: pts,
        description: deductReason,
        images: [],
        earnDate: new Date(),
        expireDate: isEarn ? new Date(Date.now() + 365 * 86400000) : null,
        status: 'approved',
      });
      wx.showToast({ title: '操作成功', icon: 'success' });
      this.setData({ deductPoints: '', deductReason: '' });
    } catch (err) {
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  onPointsInput(e) {
    // 只允许数字和负号
    const v = e.detail.value.replace(/[^-\d]/g, '');
    this.setData({ deductPoints: v });
  },
  onReasonInput(e) { this.setData({ deductReason: e.detail.value }); },
});
