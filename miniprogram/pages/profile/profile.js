// pages/profile/profile.js - 个人资料
const dbUtil = require('../../utils/db');

Page({
  data: {
    userInfo: null,
    groups: [],
    editing: false,
    selectedGroupId: '',
    groupName: '',
  },

  async onLoad() {
    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo) {
      wx.redirectTo({ url: '/pages/login/login' });
      return;
    }
    const gRes = await dbUtil.getGroups();
    let groupName = '未加入';
    if (userInfo.groupId) {
      const g = gRes.data.find(item => item._id === userInfo.groupId);
      if (g) groupName = g.name;
    }
    this.setData({ userInfo, groups: gRes.data, groupName, selectedGroupId: userInfo.groupId || '' });
  },

  // 开启编辑
  onEdit() { this.setData({ editing: true }); },

  // 取消编辑
  onCancel() {
    const userInfo = wx.getStorageSync('userInfo');
    this.setData({ editing: false, userInfo });
  },

  // 表单输入
  onInput(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`userInfo.${field}`]: e.detail.value });
  },

  // 选择群组
  onSelectGroup(e) {
    const { id } = e.currentTarget.dataset;
    this.setData({ selectedGroupId: id });
  },

  // 保存
  async onSave() {
    const { userInfo, selectedGroupId } = this.data;
    if (!userInfo.realName.trim()) return wx.showToast({ title: '姓名不能为空', icon: 'none' });
    if (!userInfo.phoneNumber.trim()) return wx.showToast({ title: '手机号不能为空', icon: 'none' });

    wx.showLoading({ title: '保存中...' });
    try {
      const updateData = {
        realName: userInfo.realName.trim(),
        phoneNumber: userInfo.phoneNumber.trim(),
        wechatId: userInfo.wechatId.trim(),
        city: userInfo.city.trim(),
        nickName: userInfo.nickName,
        avatarUrl: userInfo.avatarUrl,
        groupId: selectedGroupId || null,
      };
      await dbUtil.updateUser(userInfo._id, updateData);

      const updatedUser = { ...userInfo, ...updateData };
      wx.setStorageSync('userInfo', updatedUser);
      this.setData({ userInfo: updatedUser, editing: false });

      wx.hideLoading();
      wx.showToast({ title: '保存成功', icon: 'success' });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },
});
