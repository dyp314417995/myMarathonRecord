// pages/super-admin/manage.js - 超管：配置管理员
const dbUtil = require('../../utils/db');

Page({
  data: {
    admins: [],
    users: [],
    loading: true,
    showAdd: false,
    // 新增管理员表单
    selectedUserId: '',
    selectedUserName: '',
    validFrom: '',
    validTo: '',
    permissions: {
      approve_join: true,
      remove_user: true,
    },
  },

  async onShow() {
    await Promise.all([this.loadAdmins(), this.loadUsers()]);
  },

  // 加载管理员列表
  async loadAdmins() {
    const res = await dbUtil.getAdminList();
    // 关联用户信息
    const enriched = await Promise.all(res.data.map(async (admin) => {
      try {
        const userRes = await dbUtil.db.collection('users').doc(admin.userId).get();
        return {
          ...admin,
          userName: userRes.data.nickName || '未知',
          userAvatar: userRes.data.avatarUrl,
          isExpired: new Date(admin.validTo) < new Date(),
        };
      } catch { return admin; }
    }));
    this.setData({ admins: enriched, loading: false });
  },

  // 加载普通用户列表（用于选择）
  async loadUsers() {
    const res = await dbUtil.getUserList({ role: 'user' });
    this.setData({ users: res.data });
  },

  // 显示添加弹窗
  onShowAdd() {
    const today = this.formatDate(new Date());
    const nextYear = this.formatDate(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000));
    this.setData({
      showAdd: true, selectedUserId: '', selectedUserName: '',
      validFrom: today, validTo: nextYear,
      permissions: { approve_join: true, remove_user: true },
    });
  },

  onHideAdd() { this.setData({ showAdd: false }); },

  // 选择用户
  onSelectUser(e) {
    const { id, name } = e.currentTarget.dataset;
    this.setData({ selectedUserId: id, selectedUserName: name });
  },

  onDateInput(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [field]: e.detail.value });
  },

  onTogglePermission(e) {
    const { key } = e.currentTarget.dataset;
    this.setData({ [`permissions.${key}`]: !this.data.permissions[key] });
  },

  // 添加管理员
  async onAddAdmin() {
    const { selectedUserId, validFrom, validTo, permissions } = this.data;
    if (!selectedUserId) return wx.showToast({ title: '请选择用户', icon: 'none' });
    if (!validFrom || !validTo) return wx.showToast({ title: '请设置有效期', icon: 'none' });
    if (new Date(validTo) <= new Date(validFrom)) return wx.showToast({ title: '结束日期必须大于开始日期', icon: 'none' });

    const permList = [];
    if (permissions.approve_join) permList.push('approve_join');
    if (permissions.remove_user) permList.push('remove_user');
    if (permList.length === 0) return wx.showToast({ title: '请至少选择一个权限', icon: 'none' });

    try {
      await dbUtil.createAdmin({
        userId: selectedUserId,
        validFrom: new Date(validFrom),
        validTo: new Date(validTo),
        permissions: permList,
        status: 'active',
      });
      // 更新用户角色
      await dbUtil.updateUser(selectedUserId, { role: 'admin' });
      wx.showToast({ title: '添加成功', icon: 'success' });
      this.setData({ showAdd: false });
      this.loadAdmins();
    } catch (err) {
      wx.showToast({ title: '添加失败', icon: 'none' });
    }
  },

  // 撤销管理员
  onRevokeAdmin(e) {
    const { id, userId } = e.currentTarget.dataset;
    wx.showModal({
      title: '确认撤销',
      content: '确认撤销该用户的管理员权限？',
      confirmColor: '#ff4d4f',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await dbUtil.updateAdmin(id, { status: 'revoked' });
          await dbUtil.updateUser(userId, { role: 'user' });
          wx.showToast({ title: '已撤销', icon: 'success' });
          this.loadAdmins();
        } catch (err) {
          wx.showToast({ title: '操作失败', icon: 'none' });
        }
      }
    });
  },

  formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  },

  // 权限名称映射
  permName(key) {
    const map = { approve_join: '审批加入', remove_user: '移除用户' };
    return map[key] || key;
  },
});
