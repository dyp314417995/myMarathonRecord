// pages/profile/profile.js - 个人资料
const dbUtil = require('../../utils/db');
const { checkResult, getLimit } = require('../../utils/raceResult');

Page({
  data: {
    userInfo: wx.getStorageSync('userInfo') || {},  // 预置缓存，避免首帧闪'未设置'
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
    timeMinSec: 0, timeMaxSec: 0, timeRangeTip: '',   // PB 的合理范围，打开选择器时按项目带出
  },

  async onLoad() {
    let userInfo = wx.getStorageSync('userInfo');
    // 缓存缺失/无效：先尝试从数据库恢复登录态，避免误跳登录页闪一下
    if (!userInfo || !userInfo._id) {
      try {
        const fresh = await dbUtil.getCurrentUser();
        if (fresh && fresh._id) {
          userInfo = fresh;
          wx.setStorageSync('userInfo', fresh);
        }
      } catch (e) { console.warn('恢复登录态失败', e); }
      if (!userInfo || !userInfo._id) {
        wx.navigateTo({ url: '/pages/login/login' });
        return;
      }
    }
    // 先同步渲染缓存（避免首帧闪'未设置'），再异步刷新
    this.setData({ userInfo });
    // 从服务端刷新最新用户信息（角色/资料可能已更新），避免本地缓存旧数据闪'未设置'
    try {
      const fresh = await dbUtil.getCurrentUser();
      if (fresh) {
        userInfo = { ...userInfo, ...fresh };
        wx.setStorageSync('userInfo', userInfo);
      }
    } catch (e) { console.warn('刷新用户信息失败，使用缓存', e); }
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
    const nameList = ids.map(id => {
      const g = gRes.data.find(item => item._id === id);
      return g ? g.name : '';
    }).filter(Boolean);
    this.setData({ userInfo, groups: gRes.data, groupNames: nameList, selectedGroupIds: [...ids], selectedGroupMap: this.buildMap(ids) });
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
  onPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/index' });
  },
  onCancel() {
    const userInfo = wx.getStorageSync('userInfo');
    const ids = userInfo.groupIds || [];
    const nameList = ids.map(id => {
      const g = this.data.groups.find(item => item._id === id);
      return g ? g.name : '';
    }).filter(Boolean);
    this.setData({ editing: false, userInfo, selectedGroupIds: ids, selectedGroupMap: this.buildMap(ids), groupNames: nameList });
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
    // PB 也按项目的合理范围限制（全马 2~6 小时、半马 1~3 小时，10K 不限制）
    const raceType = { pbFull: 'full', pbHalf: 'half', pb10k: '10k' }[field] || '';
    const limit = getLimit(raceType);
    this.setData({
      showTimePicker: true, timeField: field, timeLabel: label, timeDefault: def, timeValue: val,
      timeMinSec: limit ? limit.minSec : 0,
      timeMaxSec: limit ? limit.maxSec : 0,
      timeRangeTip: limit ? limit.tip : '',
    });
  },
  onTimeConfirm(e) { this.setData({ [`userInfo.${this.data.timeField}`]: e.detail.value, showTimePicker: false }); },
  onTimeCancel() { this.setData({ showTimePicker: false }); },

  async onSave() {
    const { userInfo, selectedGroupIds } = this.data;
    if (!userInfo.nickName || !userInfo.nickName.trim()) return wx.showToast({ title: '昵称不能为空', icon: 'none' });
    if (!userInfo.phoneNumber || !userInfo.phoneNumber.trim()) return wx.showToast({ title: '手机号不能为空', icon: 'none' });
    // PB 也卡合理范围，顺带把 00:00:00 这种默认产物挡掉
    for (const [field, raceType] of [['pbFull', 'full'], ['pbHalf', 'half'], ['pb10k', '10k']]) {
      const v = userInfo[field];
      if (!v) continue;
      const chk = checkResult(v, raceType);
      if (!chk.ok) return wx.showToast({ title: chk.error, icon: 'none', duration: 2500 });
    }

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
      const nameList = selectedGroupIds.map(id => {
        const g = this.data.groups.find(item => item._id === id);
        return g ? g.name : '';
      }).filter(Boolean);
      this.setData({ userInfo: updatedUser, editing: false, groupNames: nameList, selectedGroupIds: [...selectedGroupIds], selectedGroupMap: this.buildMap(selectedGroupIds) });
      wx.hideLoading();
      wx.showToast({ title: '保存成功', icon: 'success' });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },
});
