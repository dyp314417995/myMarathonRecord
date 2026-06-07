// pages/login/login.js - 登录即注册
const dbUtil = require('../../utils/db');
const app = getApp();

Page({
  data: {
    avatarUrl: '',
    nickName: '',
    phoneNumber: '',
    realName: '',
    wechatId: '',
    city: '',
    groups: [],
    selectedGroupId: '',
    selectedGroupName: '未加入',
    submitting: false,
  },

  onLoad() {
    this.loadGroups();
  },

  // 获取群组列表
  async loadGroups() {
    const res = await dbUtil.getGroups();
    this.setData({ groups: res.data });
  },

  // 微信授权获取头像和昵称
  onChooseAvatar(e) {
    const { avatarUrl } = e.detail;
    this.setData({ avatarUrl });
  },

  onNicknameInput(e) {
    this.setData({ nickName: e.detail.value });
  },

  // 通用字段输入
  onInput(e) {
    const { field } = e.currentTarget.dataset;
    if (field) this.setData({ [field]: e.detail.value });
  },

  // 获取手机号（微信官方能力）
  async onGetPhoneNumber(e) {
    if (e.detail.errMsg !== 'getPhoneNumber:ok') return;
    try {
      const res = await wx.cloud.callFunction({
        name: 'getPhoneNumber',
        data: { cloudID: e.detail.cloudID }
      });
      if (res.result && res.result.phoneNumber) {
        this.setData({ phoneNumber: res.result.phoneNumber });
        wx.showToast({ title: '已获取手机号', icon: 'success' });
      }
    } catch (err) {
      console.error('获取手机号失败:', err);
      wx.showToast({ title: '获取手机号失败，请手动输入', icon: 'none' });
    }
  },

  // 手动输入手机号
  onPhoneInput(e) {
    this.setData({ phoneNumber: e.detail.value });
  },

  // 选择群组
  onSelectGroup(e) {
    const { id, name } = e.currentTarget.dataset;
    this.setData({
      selectedGroupId: id || '',
      selectedGroupName: name || '未加入'
    });
  },

  // 提交注册
  async onSubmit() {
    const { avatarUrl, nickName, realName, wechatId, city, phoneNumber, selectedGroupId, submitting } = this.data;
    if (submitting) return;

    // 校验
    if (!nickName.trim()) return wx.showToast({ title: '请输入昵称', icon: 'none' });
    if (!realName.trim()) return wx.showToast({ title: '请输入真实姓名', icon: 'none' });
    if (!phoneNumber.trim()) return wx.showToast({ title: '请输入手机号', icon: 'none' });
    if (!/^1\d{10}$/.test(phoneNumber.trim())) return wx.showToast({ title: '手机号格式不正确', icon: 'none' });

    this.setData({ submitting: true });
    wx.showLoading({ title: '注册中...' });

    try {
      // 检查是否已注册
      let user = await dbUtil.getCurrentUser();
      if (user) {
        // 已注册，更新信息
        await dbUtil.updateUser(user._id, {
          avatarUrl, nickName, phoneNumber: phoneNumber.trim(),
          realName: realName.trim(), wechatId: wechatId.trim(), city: city.trim(),
          groupId: selectedGroupId || null
        });
        if (selectedGroupId && user.status === 'approved') {
          await dbUtil.createJoinRequest(user._id, selectedGroupId);
        }
      } else {
        // 新用户注册
        const userData = {
          avatarUrl, nickName, phoneNumber: phoneNumber.trim(),
          realName: realName.trim(), wechatId: wechatId.trim(), city: city.trim(),
          groupId: selectedGroupId || null,
        };
        const addRes = await dbUtil.createUser(userData);
        user = { _id: addRes._id, ...userData, role: 'user', status: selectedGroupId ? 'pending' : 'approved' };
      }

      // 保存到全局和本地
      app.globalData.userInfo = user;
      wx.setStorageSync('userInfo', user);

      wx.hideLoading();
      wx.showToast({ title: selectedGroupId ? '已提交申请，等待审批' : '注册成功', icon: 'success' });
      setTimeout(() => {
        wx.reLaunch({ url: '/pages/home/home' });
      }, 1500);

    } catch (err) {
      console.error('注册失败:', err);
      wx.hideLoading();
      wx.showToast({ title: '注册失败，请重试', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  // 跳过，稍后填写
  onSkip() {
    wx.switchTab({ url: '/pages/home/home' });
  },
});
