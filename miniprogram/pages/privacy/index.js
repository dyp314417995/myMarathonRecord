// pages/privacy/index.js - 隐私设置
const dbUtil = require('../../utils/db');

Page({
  data: {
    pbPublic: true,
  },

  onShow() {
    const u = wx.getStorageSync('userInfo');
    this.setData({ pbPublic: u?.privacy_pb !== false });
  },

  async onTogglePB(e) {
    const val = e.detail.value;
    this.setData({ pbPublic: val });
    const u = wx.getStorageSync('userInfo');
    if (!u?._id) return;
    await dbUtil.updateUser(u._id, { privacy_pb: val });
    u.privacy_pb = val;
    wx.setStorageSync('userInfo', u);
  },
});
