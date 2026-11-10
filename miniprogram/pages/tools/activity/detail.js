// pages/tools/activity/detail.js
const shareUtil = require('../../../utils/share');

Page({
  data: {
    loading: true,
    loadError: false,
    activity: null,
    customValues: {},
    registered: false,
    registration: null,
    isAdmin: false,
    regList: [],
    needJoin: false,   // 未注册用户：只显示引导注册，不展示活动内容
  },

  async onLoad(options) {
    // QR扫码: scene, 直接跳转: id
    const activityId = options.scene ? decodeURIComponent(options.scene) : options.id;
    this.setData({ activityId, fromAdmin: options.from === 'admin' });
    shareUtil.enableShareMenu();
    await this.loadDetail();
  },
  async onShow() { if (this.data.activityId) await this.loadDetail(); },

  // 转发（右上角菜单 + 页面按钮）：允许分享，但对方未注册看不到内容，会先被引导注册
  onShareAppMessage() {
    const a = this.data.activity;
    return shareUtil.buildShare({
      title: a ? `${a.name}｜跑团成员可查看` : '九州战马联盟活动｜注册加入后可查看',
      path: `/pages/tools/activity/detail?id=${this.data.activityId}`,
      imageUrl: (a && a.images && a.images[0]) || '',
    });
  },

  onShareTimeline() {
    const a = this.data.activity;
    return shareUtil.buildTimeline({
      title: a ? `${a.name}｜跑团成员可查看` : '九州战马联盟活动｜注册加入后可查看',
      query: `id=${this.data.activityId}`,
      imageUrl: (a && a.images && a.images[0]) || '',
    });
  },

  goRegister() {
    wx.navigateTo({ url: '/pages/login/login' });
  },

  // 带超时的云函数调用（默认15s客户端超时）
  async callFunctionWithTimeout(params, timeoutMs = 15000) {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('云函数调用超时，请检查网络后重试')), timeoutMs)
    );
    return await Promise.race([
      wx.cloud.callFunction(params),
      timeoutPromise,
    ]);
  },

  async loadDetail() {
    const userInfo = wx.getStorageSync('userInfo');
    // 门禁：未注册用户（含分享打开的陌生人）不请求任何活动数据
    if (!userInfo || !userInfo._id) {
      this.setData({ needJoin: true, loading: false, loadError: false, activity: null, regList: [] });
      return;
    }
    this.setData({ loading: true, loadError: false, needJoin: false });
    wx.showLoading({ title: '加载中' });
    const userId = userInfo._id;

    try {
      const res = await this.callFunctionWithTimeout({ name: 'getActivities', data: { action: 'detail', id: this.data.activityId, userId } });
      // 服务端门禁兜底：账号不在成员表里 → 引导注册，不展示任何活动信息
      if (res.result && res.result.needRegister) {
        this.setData({ needJoin: true, loading: false, activity: null, regList: [] });
        wx.hideLoading();
        return;
      }
      const act = res.result;
      if (!act) throw new Error('活动不存在');

      act._fmtStart = this.fmtDate(act.timeStart);
      act._fmtEnd = act.timeEnd ? this.fmtDate(act.timeEnd) : '';
      act._fmtDeadline = act.deadline ? this.fmtDate(act.deadline) : '';
      act._expired = act.deadline && new Date(act.deadline) < new Date();
      act.regCount = act.regCount || 0;

      // 管理员：从 DB 查角色，不靠本地缓存
      let isAdmin = false;
      try {
        const db = wx.cloud.database();
        const userRes = await db.collection('users').doc(userId).get();
        const role = userRes.data ? (userRes.data.role || 'user') : 'user';
        isAdmin = role === 'admin' || role === 'super_admin';
      } catch (e) { isAdmin = false; }

      // 报名名单含手机号，仅管理员拉取；普通用户只看人数（服务端已算好）
      let regList = [];
      if (isAdmin) {
        const cntRes = await this.callFunctionWithTimeout({ name: 'getActivities', data: { action: 'registrations', id: this.data.activityId } });
        regList = (cntRes.result || {}).list || [];
      }

      // 是否已报名
      let registered = false;
      let registration = null;
      if (regList.length) {
        const mine = regList.find(r => r.userId === userId);
        if (mine) { registered = true; registration = mine; }
      } else if (!isAdmin) {
        const myRes = await this.callFunctionWithTimeout({ name: 'getActivities', data: { action: 'my', userId } }).catch(() => null);
        const myList = (myRes && myRes.result && myRes.result.list) || [];
        if (myList.some(a => a._id === this.data.activityId)) registered = true;
      }

      this.setData({
        activity: act, registered, registration, isAdmin, regList,
        loading: false, loadError: false,
      });
    } catch (e) {
      console.error('[loadDetail]', e);
      this.setData({ loading: false, loadError: true });
    }
    wx.hideLoading();
  },

  onCustomInput(e) {
    const { k } = e.currentTarget.dataset;
    this.setData({ ['customValues.' + k]: e.detail.value });
  },
  onCustomRadio(e) {
    const { k, v } = e.currentTarget.dataset;
    this.setData({ ['customValues.' + k]: v });
  },
  onCustomCheck(e) {
    const { k, v } = e.currentTarget.dataset;
    const key = k + '_' + v;
    this.setData({ ['customValues.' + key]: !this.data.customValues[key] });
  },

  async onRegister() {
    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo) {
      getApp().globalData.isGuest = false; // 退出标记清除，允许登录页自动登录
      return wx.navigateTo({ url: '/pages/login/login' });
    }

    // 验证必填字段
    const act = this.data.activity;
    // 检查报名截止
    if (act.deadline && new Date(act.deadline) < new Date()) {
      return wx.showToast({ title: '报名已截止', icon: 'none' });
    }
    if (act.customFields) {
      for (const f of act.customFields) {
        if (f.required && !this.data.customValues[f.label]) {
          return wx.showToast({ title: `请填写${f.label}`, icon: 'none' });
        }
      }
    }

    wx.showLoading({ title: '报名中' });
    try {
      const res = await this.callFunctionWithTimeout({
        name: 'getActivities',
        data: {
          action: 'register',
          activityId: this.data.activityId,
          userId: userInfo._id || userInfo.openid,
          userInfo,
          customValues: this.data.customValues,
        },
      });
      wx.hideLoading();
      if (res.result && res.result.error) {
        wx.showToast({ title: res.result.error, icon: 'none' });
      } else {
        wx.showToast({ title: '报名成功', icon: 'success' });
        this.loadDetail();
      }
    } catch (e) {
      wx.hideLoading();
      console.error('[onRegister] 报名失败:', e);
      wx.showToast({ title: '报名失败', icon: 'none' });
    }
  },

  async onUnregister() {
    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo) return;
    wx.showModal({
      title: '取消报名',
      content: '确定取消？',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '取消中' });
        try {
          await this.callFunctionWithTimeout({
            name: 'getActivities',
            data: { action: 'unregister', activityId: this.data.activityId, userId: userInfo._id },
          });
          wx.hideLoading();
          wx.showToast({ title: '已取消', icon: 'success' });
          this.loadDetail();
        } catch (e) {
          wx.hideLoading();
          console.error('[onUnregister]', e);
          wx.showToast({ title: '取消失败', icon: 'none' });
        }
      },
    });
  },

  fmtDate(d) {
    if (!d) return '';
    const dt = new Date(d);
    return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
  },
});
