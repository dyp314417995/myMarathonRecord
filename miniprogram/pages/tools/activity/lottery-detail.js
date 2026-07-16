// pages/tools/activity/lottery-detail.js
Page({
  data: {
    loading: true,
    loadError: false,
    lottery: null,
    lotteryId: '',
    codeInput: '',
    submitting: false,
    result: { show: false, type: '', title: '', invalid: [], used: [] },
  },

  onLoad(options) {
    const id = options.scene ? decodeURIComponent(options.scene) : options.id;
    if (!id) {
      this.setData({ loading: false, loadError: true });
      return;
    }
    this.setData({ lotteryId: id });
    this.loadDetail();
  },

  onShow() {
    if (this.data.lotteryId) this.loadDetail();
  },

  async loadDetail() {
    this.setData({ loading: true, loadError: false });
    wx.showLoading({ title: '加载中' });
    try {
      const userInfo = wx.getStorageSync('userInfo');
      const userId = userInfo ? (userInfo._id || userInfo.openid) : null;

      const res = await wx.cloud.callFunction({
        name: 'getLotteries',
        data: { action: 'detail', id: this.data.lotteryId, userId },
      });
      const lot = res.result;
      if (!lot || lot.error) throw new Error(lot ? lot.error : '抽奖不存在');

      this.setData({
        lottery: lot,
        loading: false,
        loadError: false,
        result: { show: false, type: '', title: '', invalid: [], used: [] },
      });
    } catch (e) {
      console.error('[lottery detail]', e);
      this.setData({ loading: false, loadError: true });
    }
    wx.hideLoading();
  },

  onCodeInput(e) {
    this.setData({ codeInput: e.detail.value, 'result.show': false });
  },

  async onSubmit() {
    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo) {
      getApp().globalData.isGuest = false;
      return wx.navigateTo({ url: '/pages/login/login' });
    }

    const raw = this.data.codeInput.trim();
    if (!raw) return wx.showToast({ title: '请输入抽奖码', icon: 'none' });

    const codes = raw.split('\n').map(s => s.trim()).filter(Boolean);
    if (!codes.length) return wx.showToast({ title: '请输入抽奖码', icon: 'none' });

    this.setData({ submitting: true });
    wx.showLoading({ title: '验证中' });

    try {
      const userId = userInfo._id || userInfo.openid;
      const res = await wx.cloud.callFunction({
        name: 'getLotteries',
        data: {
          action: 'enter',
          id: this.data.lotteryId,
          userId,
          codes,
        },
      });
      wx.hideLoading();
      const r = res.result || {};

      if (r.error) {
        wx.showToast({ title: r.error, icon: 'none' });
        this.setData({ submitting: false });
        return;
      }

      if (r.totalSuccess) {
        this.setData({
          result: {
            show: true,
            type: 'success',
            title: `✅ ${r.successCount} 个抽奖码验证成功！`,
            invalid: r.invalidCodes || [],
            used: r.alreadyUsed || [],
          },
          codeInput: '',
        });
        this.loadDetail();
      } else {
        this.setData({
          result: {
            show: true,
            type: 'fail',
            title: '❌ 没有有效的抽奖码',
            invalid: r.invalidCodes || [],
            used: r.alreadyUsed || [],
          },
        });
      }
    } catch (e) {
      wx.hideLoading();
      console.error('[onSubmit]', e);
      wx.showToast({ title: '提交失败', icon: 'none' });
    }
    this.setData({ submitting: false });
  },
});
