// pages/points/index.js - 积分首页
const pointsUtil = require('../../utils/points');

Page({
  data: {
    balance: 0,
    expiringPoints: 0,
    expiringDays: 0,
    records: [],
    rules: [],
    showRules: true,
    userId: '',
  },

  async onShow() {
    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo) return;
    this.setData({ userId: userInfo._id });
    await Promise.all([this.loadBalance(), this.loadExpiring(), this.loadRecords(), this.loadRules()]);
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
    this.setData({ rules: res.data.filter(r => r.status === 'active') });
  },

  onToggleRules() {
    this.setData({ showRules: !this.data.showRules });
  },

  onApply() {
    wx.navigateTo({ url: '/pages/points/apply' });
  },
});
