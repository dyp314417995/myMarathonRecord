// pages/home/home.js - 首页（角色面板）
const dbUtil = require('../../utils/db');
const app = getApp();

Page({
  data: {
    userInfo: {},
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
      // 始终从数据库拉最新数据
      let user = await dbUtil.getCurrentUser();
      if (!user) {
        // 数据库没有，试试本地缓存
        user = wx.getStorageSync('userInfo');
      }
      if (!user) {
        wx.redirectTo({ url: '/pages/login/login' });
        return;
      }
      // 更新本地缓存
      wx.setStorageSync('userInfo', user);

      // 兼容旧数据：groupId → groupIds
      if (!user.groupIds && user.groupId) {
        user.groupIds = [user.groupId];
        // 回写到数据库
        dbUtil.updateUser(user._id, { groupIds: [user.groupId] }).catch(() => {});
      }
      if (!user.groupIds) user.groupIds = [];

      // 读取群组名称
      const ids = user.groupIds;
      let groupName = '未加入';
      if (ids.length > 0) {
        const gRes = await dbUtil.db.collection('groups').where({ _id: dbUtil._.in(ids) }).get();
        groupName = gRes.data.map(g => g.name).join('、');
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

  // 积分
  onPoints() {
    wx.navigateTo({ url: '/pages/points/index' });
  },
  onPointsAdmin() {
    wx.navigateTo({ url: '/pages/points/admin' });
  },
});
