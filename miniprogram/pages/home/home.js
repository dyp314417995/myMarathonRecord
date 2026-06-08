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
        // 用户已被删除或不存在，清除缓存并重新注册
        wx.removeStorageSync('userInfo');
        wx.redirectTo({ url: '/pages/login/login' });
        return;
      }
      // 更新本地缓存
      wx.setStorageSync('userInfo', user);
      // 转换头像 cloud:// → 临时 URL
      if (user.avatarUrl && user.avatarUrl.startsWith('cloud://')) {
        try {
          const urlRes = await wx.cloud.getTempFileURL({ fileList: [user.avatarUrl] });
          user.avatarUrl = urlRes.fileList[0].tempFileURL;
        } catch {}
      }

      // V1.0 老用户补发 50 积分
      const pointsUtil = require('../../utils/points');
      const oldBonus = await dbUtil.db.collection('points_records')
        .where({ userId: user._id, category: '注册赠送' }).count();
      if (oldBonus.total === 0) {
        pointsUtil.addRecord({
          userId: user._id, type: 'earn', category: '注册赠送',
          points: 50, description: '新用户注册赠送（补发）',
          images: [], earnDate: user.createTime || new Date(),
          expireDate: new Date((user.createTime ? new Date(user.createTime).getTime() : Date.now()) + 365 * 86400000),
          status: 'approved',
        }).catch(() => {});
      }

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

      app.globalData.userInfo = user;
      app.globalData.isSuperAdmin = role === 'super_admin';
      app.globalData.isAdmin = role === 'admin' || role === 'super_admin';

      this.setData({ userInfo: user, role, groupName, status: user.status });

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
  onGroups() {
    wx.navigateTo({ url: '/pages/groups/index' });
  },
});
