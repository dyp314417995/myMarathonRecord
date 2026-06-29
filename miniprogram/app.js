// app.js - 我的跑马记录
App({
  globalData: {
    userInfo: null,       // 当前用户信息
    isAdmin: false,       // 是否为管理员
    isSuperAdmin: false,  // 是否为超管
    pendingActivityId: '', // 扫码待跳转的活动ID
  },

  onLaunch: function () {
    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
    } else {
      wx.cloud.init({
        env: "cloud1-d5gy0iuiba5f9300f",
        traceUser: true,
      });
    }
    this.initDefaultGroups();
    this.fixOpenid();
    this.fixUserRole();
    this.checkLaunchScene();
  },

  // 补存 openid（已有用户）
  async fixOpenid() {
    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo || !userInfo._id) return;
    const db = wx.cloud.database();
    try {
      const u = await db.collection('users').doc(userInfo._id).get();
      if (u.data && !u.data.openid) {
        const openRes = await wx.cloud.callFunction({ name: 'getOpenid' }).catch(() => ({ result: {} }));
        if (openRes.result.openid) {
          await db.collection('users').doc(userInfo._id).update({ data: { openid: openRes.result.openid } });
        }
      }
    } catch {}
  },

  // 修复本地角色：从 DB 同步真实 role
  async fixUserRole() {
    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo || !userInfo._id) return;
    const db = wx.cloud.database();
    try {
      const res = await db.collection('users').doc(userInfo._id).get();
      if (res.data && res.data.role) {
        userInfo.role = res.data.role;
        wx.setStorageSync('userInfo', userInfo);
      }
    } catch {}
  },

  onShow: function (options) {
    this.checkLaunchScene();
  },

  checkLaunchScene() {
    const scene = wx.getLaunchOptionsSync().query.scene || wx.getEnterOptionsSync().query.scene || '';
    if (!scene) return;
    const m = scene.match(/^([a-zA-Z0-9]{20,30})$/);
    if (!m) return;
    const activityId = m[1];
    const userInfo = wx.getStorageSync('userInfo');
    if (userInfo && userInfo._id) {
      // 已登录，直接跳转
      setTimeout(() => {
        wx.navigateTo({ url: `/pages/tools/activity/detail?id=${activityId}` });
      }, 500);
    } else {
      // 未登录，记住活动ID，登录后跳转
      this.globalData.pendingActivityId = activityId;
    }
  },

  // 初始化默认群组（仅当 groups 集合为空时）
  initDefaultGroups: async function () {
    const db = wx.cloud.database();
    const countRes = await db.collection('groups').count();
    if (countRes.total === 0) {
      const defaultGroups = [
        { name: '一群', description: '', remark: '群已满，请联系管理员邀请加入', sort: 1, createTime: new Date() },
        { name: '二群', description: '', remark: '群已满，请联系管理员邀请加入', sort: 2, createTime: new Date() },
        { name: '分舵群', description: '', remark: '群已满，请联系管理员邀请加入', sort: 3, createTime: new Date() },
      ];
      for (const g of defaultGroups) {
        await db.collection('groups').add({ data: g });
      }
    }
  },
});
