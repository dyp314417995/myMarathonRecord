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

    // 转换头像 cloud:// → 临时 URL
    if (userInfo.avatarUrl && userInfo.avatarUrl.startsWith('cloud://')) {
      try {
        const urlRes = await wx.cloud.getTempFileURL({ fileList: [userInfo.avatarUrl] });
        userInfo.avatarUrl = urlRes.fileList[0].tempFileURL;
      } catch {}
    }

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

  onChooseAvatar(e) {
    this.setData({ 'userInfo.avatarUrl': e.detail.avatarUrl });
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
      // 上传新头像（本地路径就上传，永久URL不过）
      let avatarUrl = userInfo.avatarUrl || '';
      if (avatarUrl && !avatarUrl.startsWith('cloud://') && !avatarUrl.startsWith('https://')) {
        try {
          const upRes = await wx.cloud.uploadFile({
            cloudPath: `avatars/${Date.now()}-${Math.random().toString(36).slice(2)}.png`,
            filePath: avatarUrl,
          });
          avatarUrl = upRes.fileID;
        } catch {}
      }

      const updateData = {
        phoneNumber: userInfo.phoneNumber.trim(),
        avatarUrl,
        city: userInfo.city ? userInfo.city.trim() : '',
        pb10k: userInfo.pb10k || '',
        pbHalf: userInfo.pbHalf || '',
        pbFull: userInfo.pbFull || '',
        nickName: userInfo.nickName,
        groupIds: selectedGroupIds,
      };
      await dbUtil.updateUser(userInfo._id, updateData);
      // 群组加入无需审批，增加新群成员数
      const oldIds = userInfo.groupIds || [];
      for (const gid of selectedGroupIds) {
        if (!oldIds.includes(gid)) {
          dbUtil.db.collection('groups').doc(gid).update({ data: { memberCount: dbUtil._.inc(1) } }).catch(() => {});
        }
      }
      for (const gid of oldIds) {
        if (!selectedGroupIds.includes(gid)) {
          dbUtil.db.collection('groups').doc(gid).update({ data: { memberCount: dbUtil._.inc(-1) } }).catch(() => {});
        }
      }

      const updatedUser = { ...userInfo, ...updateData };
      // 转换头像 cloud:// → 临时 URL 用于显示
      if (updatedUser.avatarUrl && updatedUser.avatarUrl.startsWith('cloud://')) {
        try {
          const urlRes = await wx.cloud.getTempFileURL({ fileList: [updatedUser.avatarUrl] });
          updatedUser.avatarUrl = urlRes.fileList[0].tempFileURL;
        } catch {}
      }
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
