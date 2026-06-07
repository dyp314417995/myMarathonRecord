// pages/profile/profile.js - 个人资料
const dbUtil = require('../../utils/db');

Page({
  data: {
    userInfo: {},
    groups: [],
    editing: false,
    selectedGroupIds: [],
    selectedGroupMap: {},
    groupNames: '',
    showCityPicker: false,
    showTimePicker: false,
    timeField: '',
    timeLabel: '',
    timeDefault: '0:00:00',
    timeValue: '',
  },

  async onLoad() {
    let userInfo = wx.getStorageSync('userInfo');
    if (!userInfo) {
      wx.redirectTo({ url: '/pages/login/login' });
      return;
    }
    // 兼容旧数据：groupId → groupIds
    if (!userInfo.groupIds && userInfo.groupId) {
      userInfo.groupIds = [userInfo.groupId];
    }
    if (!userInfo.groupIds) userInfo.groupIds = [];

    const gRes = await dbUtil.getGroups();
    const ids = userInfo.groupIds;
    const names = ids.map(id => {
      const g = gRes.data.find(item => item._id === id);
      return g ? g.name : '';
    }).filter(Boolean).join('、') || '未加入';
    this.setData({ userInfo, groups: gRes.data, groupNames: names, selectedGroupIds: [...ids], selectedGroupMap: this.buildMap(ids) });
  },

  buildMap(ids) {
    const map = {};
    (ids || []).forEach(id => { map[id] = true; });
    return map;
  },

  onEdit() {
    const ids = [...(this.data.userInfo.groupIds || [])];
    this.setData({ editing: true, selectedGroupIds: ids, selectedGroupMap: this.buildMap(ids) });
  },
  onCancel() {
    const userInfo = wx.getStorageSync('userInfo');
    const ids = userInfo.groupIds || [];
    const names = ids.map(id => {
      const g = this.data.groups.find(item => item._id === id);
      return g ? g.name : '';
    }).filter(Boolean).join('、') || '未加入';
    this.setData({ editing: false, userInfo, selectedGroupIds: ids, selectedGroupMap: this.buildMap(ids), groupNames: names });
  },

  onInput(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`userInfo.${field}`]: e.detail.value });
  },

  // 多选群组
  onToggleGroup(e) {
    const { id } = e.currentTarget.dataset;
    const ids = [...this.data.selectedGroupIds];
    const idx = ids.indexOf(id);
    if (idx >= 0) ids.splice(idx, 1); else ids.push(id);
    this.setData({ selectedGroupIds: ids, selectedGroupMap: this.buildMap(ids) });
  },

  onShowCityPicker() { this.setData({ showCityPicker: true }); },
  onCityConfirm(e) { this.setData({ 'userInfo.city': e.detail.value, showCityPicker: false }); },
  onCityCancel() { this.setData({ showCityPicker: false }); },

  onShowTimePicker(e) {
    const { field, label, def } = e.currentTarget.dataset;
    const val = this.data.userInfo[field] || def;
    this.setData({ showTimePicker: true, timeField: field, timeLabel: label, timeDefault: def, timeValue: val });
  },
  onTimeConfirm(e) { this.setData({ [`userInfo.${this.data.timeField}`]: e.detail.value, showTimePicker: false }); },
  onTimeCancel() { this.setData({ showTimePicker: false }); },

  async onSave() {
    const { userInfo, selectedGroupIds } = this.data;
    if (!userInfo.nickName || !userInfo.nickName.trim()) return wx.showToast({ title: '昵称不能为空', icon: 'none' });
    if (!userInfo.phoneNumber || !userInfo.phoneNumber.trim()) return wx.showToast({ title: '手机号不能为空', icon: 'none' });

    wx.showLoading({ title: '保存中...' });
    try {
      const updateData = {
        phoneNumber: userInfo.phoneNumber.trim(),
        city: userInfo.city ? userInfo.city.trim() : '',
        pb10k: userInfo.pb10k || '',
        pbHalf: userInfo.pbHalf || '',
        pbFull: userInfo.pbFull || '',
        nickName: userInfo.nickName,
        avatarUrl: userInfo.avatarUrl,
        groupIds: selectedGroupIds,
      };
      await dbUtil.updateUser(userInfo._id, updateData);
      // 为新加的群创建审批
      const oldIds = userInfo.groupIds || [];
      for (const gid of selectedGroupIds) {
        if (!oldIds.includes(gid)) await dbUtil.createJoinRequest(userInfo._id, gid);
      }

      const updatedUser = { ...userInfo, ...updateData };
      wx.setStorageSync('userInfo', updatedUser);
      // 重新计算群名
      const names = selectedGroupIds.map(id => {
        const g = this.data.groups.find(item => item._id === id);
        return g ? g.name : '';
      }).filter(Boolean).join('、') || '未加入';
      this.setData({ userInfo: updatedUser, editing: false, groupNames: names, selectedGroupIds: [...selectedGroupIds], selectedGroupMap: this.buildMap(selectedGroupIds) });
      wx.hideLoading();
      wx.showToast({ title: '保存成功', icon: 'success' });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },
});
