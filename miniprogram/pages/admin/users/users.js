// pages/admin/users/users.js - 用户管理（移除用户）
const dbUtil = require('../../../utils/db');

Page({
  data: {
    users: [],
    loading: true,
  },

  async onShow() {
    await this.loadUsers();
  },

  async loadUsers() {
    this.setData({ loading: true });
    try {
      const res = await dbUtil.getUserList();
      // 关联群组名称
      const groupsRes = await dbUtil.getGroups();
      const groupMap = {};
      groupsRes.data.forEach(g => { groupMap[g._id] = g.name; });

      const users = res.data.map(u => ({
        ...u,
        groupName: (u.groupIds || []).map(id => groupMap[id] || '').filter(Boolean).join('、') || '未加入',
      }));
      this.setData({ users, loading: false });
    } catch (err) {
      console.error('加载用户列表失败:', err);
      this.setData({ loading: false });
    }
  },

  // 移除用户
  onRemoveUser(e) {
    const { id, name } = e.currentTarget.dataset;
    wx.showModal({
      title: '确认移除',
      content: `确认将用户"${name}"移出群组？此操作不可撤销。`,
      confirmColor: '#ff4d4f',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await dbUtil.updateUser(id, { groupIds: [], status: 'approved' });
          wx.showToast({ title: '已移除', icon: 'success' });
          this.loadUsers();
        } catch (err) {
          wx.showToast({ title: '操作失败', icon: 'none' });
        }
      }
    });
  },

  // 查看用户详情
  onViewUser(e) {
    const { id } = e.currentTarget.dataset;
    // 可跳转到用户详情页（后续版本）
    wx.showToast({ title: '用户详情（后续版本）', icon: 'none' });
  },
});
