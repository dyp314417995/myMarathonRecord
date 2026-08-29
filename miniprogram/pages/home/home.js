// pages/home/home.js - 首页（角色面板）
const dbUtil = require('../../utils/db');
const shareUtil = require('../../utils/share');
const app = getApp();

Page({
  data: {
    userInfo: wx.getStorageSync('userInfo') || {},  // 预置缓存，避免首帧闪'未设置'
    role: '',          // 'super_admin' | 'admin' | 'user'
    groupName: '',
    status: '',
    pendingCount: 0,   // 待审批数
    isGuest: false,
  },

  async onShow() {
    shareUtil.enableShareMenu();
    // 先用缓存同步渲染（避免闪'未设置'/游客页），再异步刷新
    const cached = wx.getStorageSync('userInfo');
    if (cached && cached._id) {
      // 有有效缓存：清除可能残留的退出标记，避免误闪游客页
      if (wx.getStorageSync('_logged_out')) wx.removeStorageSync('_logged_out');
      if (app.globalData.isGuest) app.globalData.isGuest = false;
      this.setData({ userInfo: cached, role: cached.role || '', isGuest: false });
    } else {
      // 无有效缓存：按退出标记同步判定游客态，避免先闪已登录页
      this.setData({ isGuest: !!wx.getStorageSync('_logged_out') });
    }
    await this.loadUserInfo();
  },

  onShareAppMessage() {
    return {
      title: '九州战马跑团｜一起跑步，记录每一公里',
      path: '/pages/home/home',
    };
  },

  async loadUserInfo() {
    try {
      const cached = wx.getStorageSync('userInfo');

      // 退出标记：有有效缓存视为已登录（清除残留标记），无缓存才进入游客态
      if (wx.getStorageSync('_logged_out')) {
        if (cached && cached._id) {
          wx.removeStorageSync('_logged_out');
        } else {
          this.setData({ isGuest: true });
          return;
        }
      }

      // 全局游客标记：有有效缓存视为已重新登录，否则保持游客状态
      if (app.globalData.isGuest) {
        if (cached && cached._id) {
          app.globalData.isGuest = false;
        } else {
          this.setData({ isGuest: true });
          return;
        }
      }

      // 始终从数据库拉最新数据
      let user = await dbUtil.getCurrentUser();
      if (!user) {
        wx.removeStorageSync('userInfo');
        this.setData({ isGuest: true });
        return;
      }
      // 更新本地缓存
      wx.setStorageSync('userInfo', user);
      // 转换头像 cloud:// → 临时 URL
      if (user.avatarUrl && user.avatarUrl.startsWith('cloud://')) {
        try {
          const r = await wx.cloud.callFunction({ name: 'getImageUrls', data: { fileIDs: [user.avatarUrl] } });
          const tempUrl = r.result[0] && r.result[0].tempFileURL;
          if (tempUrl) user.avatarUrl = tempUrl;
        } catch {
          try {
            const r2 = await wx.cloud.getTempFileURL({ fileList: [user.avatarUrl] });
            if (r2.fileList[0].tempFileURL) user.avatarUrl = r2.fileList[0].tempFileURL;
          } catch {}
        }
      }

      // V1.0 老用户补发注册赠送积分（从规则表读取）
      const pointsUtil = require('../../utils/points');
      const oldBonus = await dbUtil.db.collection('points_records')
        .where({ userId: user._id, category: '注册赠送' }).count();
      if (oldBonus.total === 0) {
        const regPoints = await pointsUtil.getRulePoints('注册赠送');
        if (regPoints > 0) {
          pointsUtil.addRecord({
            userId: user._id, type: 'earn', category: '注册赠送',
            points: regPoints, description: '新用户注册赠送（补发）',
            images: [], earnDate: user.createTime || new Date(),
            expireDate: new Date((user.createTime ? new Date(user.createTime).getTime() : Date.now()) + 365 * 86400000),
            status: 'approved',
          }).catch(() => {});
        }
      }

      // 签到功能上线：老用户（无 signin_cards_granted 标记）补发 2 张补签卡（仅一次）
      if (!user.signin_cards_granted) {
        const cardCount = await dbUtil.db.collection('makeup_card')
          .where({ userId: user._id }).count().catch(() => ({ total: 0 }));
        if (cardCount.total === 0) {
          const now = new Date();
          const expireAt = new Date(now.getTime() + 30 * 86400000);
          for (let i = 0; i < 2; i++) {
            dbUtil.db.collection('makeup_card').add({
              data: {
                userId: user._id, source: 1, expire_at: expireAt,
                status: 0, used_at: null, created_at: now,
              },
            }).catch(() => {});
          }
        }
        dbUtil.updateUser(user._id, { signin_cards_granted: true }).catch(() => {});
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
  // 每日签到
  onLedger() {
    wx.navigateTo({ url: '/pages/tools/ledger/index' });
  },

  onSignin() {
    wx.navigateTo({ url: '/pages/signin/index' });
  },

  onPointsAdmin() {
    wx.navigateTo({ url: '/pages/points/admin' });
  },
  onGroups() {
    wx.navigateTo({ url: '/pages/groups/index' });
  },
  onMemberList() {
    wx.navigateTo({ url: '/pages/admin/members/members' });
  },
  onAiCoach() {
    wx.navigateTo({ url: '/pages/tools/coach/coach' });
  },
  onRecords() {
    wx.navigateTo({ url: '/pages/records/index' });
  },
  onManageRaces() {
    wx.navigateTo({ url: '/pages/admin/races/races' });
  },
  onManageActivities() {
    wx.navigateTo({ url: '/pages/admin/activities/activities' });
  },
  onManageLotteries() {
    wx.navigateTo({ url: '/pages/admin/lotteries/lotteries' });
  },
  onCalendar() {
    wx.navigateTo({ url: '/pages/tools/calendar/index' });
  },
  onActivity() {
    wx.navigateTo({ url: '/pages/tools/activity/index' });
  },

  // 复制微信号
  onCopyWechat() {
    wx.setClipboardData({
      data: 'dyp1314sxm',
      success: () => wx.showToast({ title: '已复制微信号', icon: 'success' }),
    });
  },

  // 游客→登录注册
  onGoLogin() {
    app.globalData.isGuest = false; // 清除退出标记，允许重新登录
    wx.navigateTo({ url: '/pages/login/login' });
  },

  // 退出登录
  onLogout() {
    wx.showModal({
      title: '确认退出',
      content: '退出后仍可浏览赛事信息',
      success: (res) => {
        if (res.confirm) {
          wx.removeStorageSync('userInfo');
          wx.setStorageSync('_logged_out', true); // 退出标记，阻止静默自动登录
          app.globalData.userInfo = null;
          app.globalData.isSuperAdmin = false;
          app.globalData.isAdmin = false;
          app.globalData.isGuest = true;
          wx.reLaunch({ url: '/pages/home/home' });
        }
      },
    });
  },
});
