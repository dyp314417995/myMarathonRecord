// pages/tools/activity/detail.js
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
  },

  async onLoad(options) {
    // QR扫码: scene, 直接跳转: id
    const activityId = options.scene ? decodeURIComponent(options.scene) : options.id;
    this.setData({ activityId, fromAdmin: options.from === 'admin' });
    await this.loadDetail();
  },
  async onShow() { if (this.data.activityId) await this.loadDetail(); },

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
    this.setData({ loading: true, loadError: false });
    wx.showLoading({ title: '加载中' });
    const userInfo = wx.getStorageSync('userInfo');
    const userId = userInfo ? (userInfo._id || userInfo.openid) : null;

    try {
      const res = await this.callFunctionWithTimeout({ name: 'getActivities', data: { action: 'detail', id: this.data.activityId } });
      const act = res.result;
      if (!act) throw new Error('活动不存在');

      // 报名人数
      const cntRes = await this.callFunctionWithTimeout({ name: 'getActivities', data: { action: 'registrations', id: this.data.activityId } });
      const allRegs = (cntRes.result || {}).list || [];
      act.regCount = allRegs.length;

      act._fmtStart = this.fmtDate(act.timeStart);
      act._fmtEnd = act.timeEnd ? this.fmtDate(act.timeEnd) : '';
      act._fmtDeadline = act.deadline ? this.fmtDate(act.deadline) : '';
      act._expired = act.deadline && new Date(act.deadline) < new Date();

      // 管理员：从 DB 查，不靠本地缓存
      let isAdmin = false;
      if (userInfo && userInfo._id) {
        const db = wx.cloud.database();
        const userRes = await db.collection('users').doc(userInfo._id).get();
        const role = userRes.data ? (userRes.data.role || 'user') : 'user';
        isAdmin = role === 'admin' || role === 'super_admin';
      }

      // 是否已报名
      let registered = false;
      if (userId) {
        const mine = allRegs.find(r => r.userId === userId);
        if (mine) { registered = true; this.setData({ registration: mine }); }
      }

      this.setData({ activity: act, registered, isAdmin, regList: isAdmin ? allRegs : [], loading: false, loadError: false });
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
