// app.js - 我的跑马记录
App({
  globalData: {
    userInfo: null,       // 当前用户信息
    isAdmin: false,       // 是否为管理员
    isSuperAdmin: false,  // 是否为超管
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
    // 首次进入时初始化默认群组
    this.initDefaultGroups();
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
