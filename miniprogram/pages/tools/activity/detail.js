// pages/tools/activity/detail.js
Page({
  data: {
    activity: null,
    customValues: {},
    registered: false,
    registration: null,
    isAdmin: false,
    regList: [],
  },

  async onLoad(options) {
    this.setData({ activityId: options.id });
    await this.loadDetail();
  },
  async onShow() { if (this.data.activityId) await this.loadDetail(); },

  async loadDetail() {
    wx.showLoading({ title: '加载中' });
    const userInfo = wx.getStorageSync('userInfo');
    const userId = userInfo ? (userInfo._id || userInfo.openid) : null;

    try {
      const res = await wx.cloud.callFunction({ name: 'getActivities', data: { action: 'detail', id: this.data.activityId } });
      const act = res.result;
      // 报名人数
      const cntRes = await wx.cloud.callFunction({ name: 'getActivities', data: { action: 'registrations', id: this.data.activityId } });
      const allRegs = (cntRes.result || {}).list || [];
      act.regCount = allRegs.length;

      act._fmtStart = this.fmtDate(act.timeStart);
      act._fmtEnd = act.timeEnd ? this.fmtDate(act.timeEnd) : '';
      act._fmtDeadline = act.deadline ? this.fmtDate(act.deadline) : '';

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

      this.setData({ activity: act, registered, isAdmin, regList: isAdmin ? allRegs : [] });
    } catch (e) { console.error(e); }
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
    if (!userInfo) return wx.showToast({ title: '请先登录', icon: 'none' });

    // 验证必填字段
    const act = this.data.activity;
    if (act.customFields) {
      for (const f of act.customFields) {
        if (f.required && !this.data.customValues[f.label]) {
          return wx.showToast({ title: `请填写${f.label}`, icon: 'none' });
        }
      }
    }

    wx.showLoading({ title: '报名中' });
    try {
      const res = await wx.cloud.callFunction({
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
      wx.showToast({ title: '报名失败', icon: 'none' });
    }
  },

  async onUnregister() {
    const userInfo = wx.getStorageSync('userInfo');
    wx.showModal({
      title: '取消报名',
      content: '确定取消？',
      success: async (res) => {
        if (!res.confirm) return;
        await wx.cloud.callFunction({
          name: 'getActivities',
          data: { action: 'unregister', activityId: this.data.activityId, userId: userInfo._id },
        });
        wx.showToast({ title: '已取消', icon: 'success' });
        this.loadDetail();
      },
    });
  },

  fmtDate(d) {
    if (!d) return '';
    const dt = new Date(d);
    return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
  },
});
