// pages/points/index.js - 积分首页
const pointsUtil = require('../../utils/points');
const shareUtil = require('../../utils/share');
const signinUtil = require('../../utils/signin');

Page({
  data: {
    balance: 0,
    expiringPoints: 0,
    expiringDays: 0,
    records: [],
    rules: [],
    showRules: true,
    userId: '',
    signedToday: false,
  },

  async onShow() {
    shareUtil.enableShareMenu();
    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo) return;
    this.setData({ userId: userInfo._id });
    await Promise.all([this.loadBalance(), this.loadExpiring(), this.loadRecords(), this.loadRules(), this.loadSigninStatus()]);
  },

  async loadSigninStatus() {
    try {
      const res = await signinUtil.getInfo(false);
      if (res && res.ok) this.setData({ signedToday: !!res.signed });
    } catch (e) { /* 忽略 */ }
  },

  async loadBalance() {
    const balance = await pointsUtil.getBalance(this.data.userId);
    this.setData({ balance });
  },

  async loadExpiring() {
    const res = await pointsUtil.getExpiringSoon(this.data.userId, 30);
    const points = res.data.reduce((s, r) => s + r.points, 0);
    const days = res.data.length > 0
      ? Math.ceil((new Date(res.data[0].expireDate) - new Date()) / 86400000)
      : 0;
    this.setData({ expiringPoints: points, expiringDays: days });
  },

  async loadRecords() {
    const res = await pointsUtil.getRecords(this.data.userId);
    const records = res.data.map(r => ({
      ...r,
      fmtTime: this.fmtDate(r.createTime),
      fmtPoints: r.points > 0 ? `+${r.points}` : `${Math.abs(r.points)}`,
    }));
    this.setData({ records });
  },

  fmtDate(d) {
    if (!d) return '';
    const dt = new Date(d);
    const M = String(dt.getMonth() + 1).padStart(2, '0');
    const D = String(dt.getDate()).padStart(2, '0');
    const h = String(dt.getHours()).padStart(2, '0');
    const m = String(dt.getMinutes()).padStart(2, '0');
    return `${M}-${D} ${h}:${m}`;
  },

  async loadRules() {
    const res = await pointsUtil.getRules();
    const rules = (res.data || []).filter(r => r.status === 'active').map(r => ({
      ...r,
      limitText: pointsUtil.getRuleLimitText(r),
      _expanded: false,
    }));
    this.setData({ rules });
  },

  // 点击规则：展开/收起下方规则说明（不再弹窗）
  onRuleTap(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({
      rules: this.data.rules.map(r => ({
        ...r,
        _expanded: r._id === id ? !r._expanded : false,
      })),
    });
  },

  async onWithdraw(e) {
    const id = e.currentTarget.dataset.id;
    const r = this.data.records.find(x => x._id === id);
    wx.showModal({
      title: '撤回申请',
      content: `确定撤回"${r ? r.category : ''}"的积分申请？`,
      confirmText: '撤回',
      confirmColor: '#ff4d4f',
      success: async (res) => {
        if (!res.confirm) return;
        await pointsUtil.withdrawRecord(id);
        wx.showToast({ title: '已撤回', icon: 'success' });
        this.loadRecords();
        this.loadBalance();
      },
    });
  },

  onShareAppMessage() {
    const u = wx.getStorageSync('userInfo');
    return {
      title: u && u.nickName ? `${u.nickName} 的九州战马积分` : '九州战马积分中心',
      path: '/pages/points/index',
    };
  },

  onSignin() {
    wx.navigateTo({ url: '/pages/signin/index' });
  },

  onExchangeCard() {
    wx.navigateTo({ url: '/pages/signin/index?exchange=1' });
  },

  onApply() {
    wx.navigateTo({ url: '/pages/points/apply' });
  },
});
