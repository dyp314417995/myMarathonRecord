// pages/points/admin.js - 积分管理后台
const pointsUtil = require('../../utils/points');
const dbUtil = require('../../utils/db');

Page({
  data: {
    isSuperAdmin: false,
    isAdmin: false,
    tab: 'rules',
    rules: [],
    pendingList: [],
    reviewedList: [],
    users: [],
    selectedUserIds: {},
    selectedUserNames: {},
    selectedNamesText: '',
    selectedNamesMore: '',
    selectedNamesAll: '',
    showAllNames: false,
    deductPoints: '',
    deductReason: '',
    deductImages: [],
    selectedCount: 0,
    isMulti: false,
    showUserPicker: false,
    userFilter: '',
  },

  async onShow() {
    const userInfo = wx.getStorageSync('userInfo') || {};
    this.setData({
      isSuperAdmin: userInfo.role === 'super_admin',
      isAdmin: userInfo.role === 'super_admin' || userInfo.role === 'admin',
    });
    await pointsUtil.initDefaultRules();
    await Promise.all([this.loadRules(), this.loadPending(), this.loadUsers()]);
  },

  onTabChange(e) {
    this.setData({ tab: e.currentTarget.dataset.tab });
    if (e.currentTarget.dataset.tab === 'review') this.loadPending();
  },

  onGoApply() {
    wx.navigateTo({ url: '/pages/points/apply' });
  },

  onPreviewImg(e) {
    const { src } = e.currentTarget.dataset;
    wx.previewImage({ urls: [src], current: src });
  },

  // ========== 规则 ==========
  async loadRules() {
    const res = await pointsUtil.getRules();
    this.setData({ rules: res.data });
  },

  async onToggleRuleStatus(e) {
    const { id, status } = e.currentTarget.dataset;
    const newStatus = status === 'active' ? 'disabled' : 'active';
    await pointsUtil.updateRule(id, { status: newStatus });
    this.loadRules();
  },

  // ========== 审批 ==========
  async loadPending() {
    // 待审批
    const res = await pointsUtil.getPendingRecords();
    const enriched = (await Promise.all(res.data.map(async (r) => this.enrichRecord(r)))).filter(Boolean);
    // 已审核（最近20条）
    const reviewedRes = await dbUtil.db.collection('points_records')
      .where({ status: dbUtil._.neq('pending') })
      .orderBy('createTime', 'desc').limit(20).get();
    const enrichedReviewed = (await Promise.all(reviewedRes.data.map(async (r) => this.enrichRecord(r)))).filter(Boolean);
    this.setData({ pendingList: enriched, reviewedList: enrichedReviewed });
  },

  async enrichRecord(r) {
    try {
      const u = await dbUtil.db.collection('users').doc(r.userId).get();
      if (!u.data) return null; // 用户已删除
      let imgUrls = [];
      let imgs = r.images;
      if (imgs && typeof imgs === 'string') imgs = [imgs];
      if (imgs && imgs.length > 0) {
        try {
          const urlRes = await wx.cloud.callFunction({ name: 'getImageUrls', data: { fileIDs: imgs } });
          imgUrls = (urlRes.result || []).filter(f => f.tempFileURL).map(f => f.tempFileURL);
        } catch {}
      }
      return { ...r, userName: u.data.nickName || '未知', imgUrls, fmtTime: this.fmtDate(r.createTime), fmtId: r._id.slice(-8) };
    } catch { return null; }
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

  async onApprove(e) {
    const { id } = e.currentTarget.dataset;
    const reviewer = wx.getStorageSync('userInfo');
    // 获取工单信息
    const recordRes = await dbUtil.db.collection('points_records').doc(id).get();
    const record = recordRes.data;
    // 更新工单状态
    await dbUtil.db.collection('points_records').doc(id).update({
      data: { status: 'approved', reviewerId: reviewer?._id, reviewTime: new Date() }
    });
    // 给用户加分
    if (record && record.userId && record.points) {
      const inc = record.type === 'earn' ? record.points : -record.points;
      await dbUtil.db.collection('users').doc(record.userId).update({
        data: { points: dbUtil._.inc(inc) }
      });
    }
    wx.showToast({ title: '已通过', icon: 'success' });
    this.loadPending();
  },

  async onReject(e) {
    const { id } = e.currentTarget.dataset;
    wx.showModal({
      title: '驳回原因',
      editable: true,
      placeholderText: '请填写驳回原因',
      confirmText: '驳回',
      success: async (res) => {
        if (!res.confirm) return;
        const reason = res.content || '';
        const reviewer = wx.getStorageSync('userInfo');
        await dbUtil.db.collection('points_records').doc(id).update({
          data: { status: 'rejected', rejectReason: reason, reviewerId: reviewer?._id, reviewTime: new Date() }
        });
        wx.showToast({ title: '已驳回', icon: 'success' });
        this.loadPending();
      }
    });
  },

  // ========== 手动录入/扣减 ==========
  async loadUsers() {
    const res = await dbUtil.getUserList({}, 0, 20);
    this.setData({ users: res.data });
  },

  onSearchUser(e) {
    const kw = e.detail.value || '';
    this.setData({ userFilter: kw });
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(async () => {
      if (kw) {
        const res = await dbUtil.getUserList({ nickName: dbUtil.db.RegExp({ regexp: kw, options: 'i' }) }, 0, 20);
        this.setData({ filteredUsers: res.data });
      } else {
        this.setData({ filteredUsers: this.data.users });
      }
    }, 200);
  },

  showUserPicker() {
    this.setData({ showUserPicker: true, userFilter: '', filteredUsers: this.data.users || [] });
  },

  onSelectUser(e) {
    const { id, name } = e.currentTarget.dataset;
    const ids = { ...this.data.selectedUserIds };
    const namesObj = { ...(this.data.selectedUserNames || {}) };
    if (ids[id]) { delete ids[id]; delete namesObj[id]; }
    else { ids[id] = true; namesObj[id] = name || ''; }
    const vals = Object.values(namesObj).filter(Boolean);
    const count = vals.length;
    const max = 5;
    let text = vals.slice(0, max).join('、');
    let more = '';
    if (count > max) {
      text += ' ...';
      more = `等${count}人`;
    }
    const all = vals.join('、');
    this.setData({ selectedUserIds: ids, selectedUserNames: namesObj, selectedCount: count, selectedNamesText: text, selectedNamesMore: more, selectedNamesAll: all, showAllNames: false });
  },

  hideUserPicker() { this.setData({ showUserPicker: false }); },

  onToggleShowAll() {
    this.setData({ showAllNames: !this.data.showAllNames });
  },

  async onSubmitDeduct() {
    const { selectedUserIds, deductPoints, deductReason } = this.data;
    const userIds = Object.keys(selectedUserIds);
    if (userIds.length === 0) return wx.showToast({ title: '请选择用户', icon: 'none' });
    const pts = parseInt(deductPoints);
    if (isNaN(pts) || pts === 0) return wx.showToast({ title: '请输入积分数量', icon: 'none' });
    if (!deductReason.trim()) return wx.showToast({ title: '请输入原因', icon: 'none' });

    // 扣减时检查余额
    if (pts < 0) {
      for (const uid of userIds) {
        const balance = await pointsUtil.getBalance(uid);
        if (balance < Math.abs(pts)) return wx.showToast({ title: `${this.data.allUsers.find(u => u._id === uid)?.nickName || uid} 余额不足`, icon: 'none' });
      }
    }

    const isEarn = pts > 0;
    wx.showLoading({ title: '处理中...' });
    try {
      // 上传图片
      let fileIDs = [];
      const { deductImages } = this.data;
      for (const img of deductImages) {
        const up = await wx.cloud.uploadFile({
          cloudPath: `points/${Date.now()}-${Math.random().toString(36).slice(2)}.png`,
          filePath: img,
        });
        fileIDs.push(up.fileID);
      }
      for (const uid of userIds) {
        await pointsUtil.addRecord({
          userId: uid,
          type: isEarn ? 'earn' : 'use',
          category: isEarn ? '集体活动' : '消耗',
          points: pts,
          description: deductReason,
          images: fileIDs,
          earnDate: new Date(),
          expireDate: isEarn ? new Date(Date.now() + 365 * 86400000) : null,
          status: 'approved',
        });
      }
      wx.hideLoading();
      wx.showToast({ title: `已为 ${userIds.length} 人操作成功`, icon: 'success' });
      this.setData({ deductPoints: '', deductReason: '', deductImages: [], selectedUserIds: {}, selectedUserNames: {}, selectedCount: 0, selectedNamesText: '' });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  onPointsInput(e) {
    const v = String(e.detail.value || '').replace(/[^-\d]/g, '');
    const isNum = v !== '' && parseInt(v) !== 0;
    if (!isNum) {
      this.setData({ deductPoints: v, selectedUserIds: {}, selectedUserNames: {}, selectedCount: 0, selectedNamesText: '' });
    } else {
      this.setData({ deductPoints: v });
    }
  },
  onPointsBlur(e) {
    const v = String(e.detail.value || '').replace(/[^-\d]/g, '');
    this.setData({ deductPoints: v });
  },
  onReasonInput(e) { this.setData({ deductReason: e.detail.value }); },

  onChooseDeductImage() {
    wx.chooseMedia({
      count: 4 - this.data.deductImages.length, mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const imgs = [...this.data.deductImages, ...res.tempFiles.map(f => f.tempFilePath)];
        this.setData({ deductImages: imgs });
      },
    });
  },

  onRemoveDeductImage(e) {
    const idx = e.currentTarget.dataset.idx;
    const imgs = [...this.data.deductImages];
    imgs.splice(idx, 1);
    this.setData({ deductImages: imgs });
  },
});
