// pages/home/home.js - 首页（角色面板）
const dbUtil = require('../../utils/db');
const app = getApp();

Page({
  data: {
    userInfo: null,
    role: '',          // 'super_admin' | 'admin' | 'user'
    groupName: '',
    status: '',
    pendingCount: 0,   // 待审批数
  },

  async onShow() {
    await this.loadUserInfo();
  },

  async loadUserInfo() {
    try {
      let user = wx.getStorageSync('userInfo');
      if (!user) {
        user = await dbUtil.getCurrentUser();
        if (!user) {
          wx.redirectTo({ url: '/pages/login/login' });
          return;
        }
        wx.setStorageSync('userInfo', user);
      }

      // 读取群组名称
      let groupName = '未加入';
      if (user.groupId) {
        const gRes = await dbUtil.db.collection('groups').doc(user.groupId).get();
        if (gRes.data) groupName = gRes.data.name;
      }

      // 检查管理员身份
      let role = user.role || 'user';
      if (role !== 'super_admin') {
        const adminInfo = await dbUtil.checkIsAdmin(user._id);
        role = adminInfo ? 'admin' : 'user';
      }

      // 超管和管理员获取待审批数
      let pendingCount = 0;
      if (role === 'super_admin' || role === 'admin') {
        const pendingRes = await dbUtil.getPendingRequests();
        pendingCount = pendingRes.data.length;
      }

      app.globalData.userInfo = user;
      app.globalData.isSuperAdmin = role === 'super_admin';
      app.globalData.isAdmin = role === 'admin' || role === 'super_admin';

      this.setData({ userInfo: user, role, groupName, status: user.status, pendingCount });

    } catch (err) {
      console.error('加载用户信息失败:', err);
    }
  },

  // 超管：管理管理员
  onManageAdmins() {
    wx.navigateTo({ url: '/pages/super-admin/manage' });
  },

  // 审批加群
  onApproval() {
    wx.navigateTo({ url: '/pages/admin/approval/approval' });
  },

  // 管理用户
  onManageUsers() {
    wx.navigateTo({ url: '/pages/admin/users/users' });
  },

  // 管理群组
  onManageGroups() {
    wx.navigateTo({ url: '/pages/admin/groups/groups' });
  },

  // 查看个人资料
  onProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' });
  },
});
