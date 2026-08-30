// pages/points/admin.js - 积分管理后台
const pointsUtil = require('../../utils/points');
const dbUtil = require('../../utils/db');

Page({
  data: {
    isSuperAdmin: false,
    isAdmin: false,
    tab: 'rules',
    reviewSub: 'pending',    // pending | done
    rules: [],
    pendingList: [],
    reviewedList: [],
    pendingRegList: [],  // 注册待审核用户
    pendingSkip: 0,
    reviewedSkip: 0,
    hasMorePending: false,
    hasMoreReviewed: false,
    users: [],
    selectedUserIds: {},
    selectedUserNames: {},
    selectedUserBalances: {},
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
    // 规则编辑表单
    showRuleForm: false,
    editingRuleId: '',
    ruleForm: { name: '', description: '', points: '', minPoints: '', maxPoints: '', maxQty: '1', period: '', limitCount: '', status: 'active', needSubmit: true },
    periodOptions: [
      { v: '', t: '不限制' },
      { v: 'day', t: '每天' },
      { v: 'week', t: '每周' },
      { v: 'month', t: '每月' },
    ],
  },

  async onShow() {
    const userInfo = wx.getStorageSync('userInfo') || {};
    this.setData({
      isSuperAdmin: userInfo.role === 'super_admin',
      isAdmin: userInfo.role === 'super_admin' || userInfo.role === 'admin',
    });
    await pointsUtil.migrateRules();
    await Promise.all([this.loadRules(), this.loadPending(true), this.loadUsers(), this.loadPendingRegisters()]);
  },

  onTabChange(e) {
    this.setData({ tab: e.currentTarget.dataset.tab });
    if (e.currentTarget.dataset.tab === 'review') {
      this.setData({ reviewSub: 'pending' });
      this.loadPending(true);
      this.loadPendingRegisters();
    }
  },

  // 加载注册待审核用户（status=pending 且未选群）
  async loadPendingRegisters() {
    try {
      const res = await dbUtil.db.collection('users')
        .where({ status: 'pending' })
        .orderBy('createTime', 'desc')
        .limit(50)
        .get();
      const list = await Promise.all((res.data || []).map(async (u) => {
        let avatar = u.avatarUrl || '';
        if (avatar && avatar.startsWith('cloud://')) {
          try { const r = await wx.cloud.getTempFileURL({ fileList: [avatar] }); avatar = r.fileList[0].tempFileURL; } catch {}
        }
        return {
          _id: u._id,
          userName: u.nickName || '未知',
          userAvatar: avatar,
          userCity: u.city || '',
          phoneNumber: u.phoneNumber || '',
          createTime: this.fmtDate(u.createTime),
        };
      }));
      this.setData({ pendingRegList: list });
    } catch (err) {
      console.error('加载注册审核列表失败:', err);
    }
  },

  // 通过注册审核
  onApproveRegister(e) {
    const userId = e.currentTarget.dataset.id;
    wx.showModal({
      title: '确认通过',
      content: '确认通过该用户的注册申请？',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await dbUtil.updateUser(userId, { status: 'approved' });
          wx.showToast({ title: '已通过', icon: 'success' });
          this.loadPendingRegisters();
        } catch (err) {
          wx.showToast({ title: '操作失败', icon: 'none' });
        }
      }
    });
  },

  // 拒绝注册
  onRejectRegister(e) {
    const userId = e.currentTarget.dataset.id;
    wx.showModal({
      title: '确认拒绝',
      content: '确认拒绝该用户的注册申请？',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await dbUtil.updateUser(userId, { status: 'rejected' });
          wx.showToast({ title: '已拒绝', icon: 'success' });
          this.loadPendingRegisters();
        } catch (err) {
          wx.showToast({ title: '操作失败', icon: 'none' });
        }
      }
    });
  },

  onReviewSub(e) {
    this.setData({ reviewSub: e.currentTarget.dataset.v });
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
    const rules = (res.data || []).map(r => ({
      ...r,
      limitText: pointsUtil.getRuleLimitText(r),
      submitText: pointsUtil.isNeedSubmit(r) ? '用户可提交' : '无需提交',
    }));
    this.setData({ rules });
  },

  async onToggleRuleStatus(e) {
    const { id, status } = e.currentTarget.dataset;
    const newStatus = status === 'active' ? 'disabled' : 'active';
    await pointsUtil.updateRule(id, { status: newStatus });
    this.loadRules();
  },

  // 新增规则
  onAddRule() {
    this.setData({
      showRuleForm: true,
      editingRuleId: '',
      ruleForm: { name: '', description: '', points: '', minPoints: '', maxPoints: '', maxQty: '1', period: '', limitCount: '', status: 'active', needSubmit: true },
    });
  },

  // 编辑规则
  onEditRule(e) {
    const r = this.data.rules.find(x => x._id === e.currentTarget.dataset.id);
    if (!r) return;
    this.setData({
      showRuleForm: true,
      editingRuleId: r._id,
      ruleForm: {
        name: r.name || '',
        description: r.description || '',
        points: String(r.points != null ? r.points : ''),
        minPoints: String(r.minPoints != null ? r.minPoints : ''),
        maxPoints: String(r.maxPoints != null ? r.maxPoints : ''),
        maxQty: String(r.maxQty != null ? r.maxQty : '1'),
        period: r.period || (r.monthlyLimit ? 'month' : ''),
        limitCount: String(r.limitCount || r.monthlyLimit || ''),
        status: r.status || 'active',
        needSubmit: pointsUtil.isNeedSubmit(r),
      },
    });
  },

  onHideRuleForm() { this.setData({ showRuleForm: false }); },

  onRuleInput(e) {
    const k = e.currentTarget.dataset.k;
    this.setData({ ['ruleForm.' + k]: e.detail.value });
  },

  onRuleNeedSubmit(e) {
    this.setData({ 'ruleForm.needSubmit': e.currentTarget.dataset.v === '1' });
  },

  onRulePeriod(e) {
    this.setData({ 'ruleForm.period': e.currentTarget.dataset.v });
  },

  onRuleStatus(e) {
    this.setData({ 'ruleForm.status': e.currentTarget.dataset.v });
  },

  async onSaveRule() {
    const f = this.data.ruleForm;
    const name = f.name.trim();
    if (!name) return wx.showToast({ title: '请填写规则名称', icon: 'none' });
    const points = parseInt(f.points, 10);
    if (isNaN(points) || points <= 0) return wx.showToast({ title: '请填写有效积分值', icon: 'none' });
    let limitCount = 0;
    if (f.period) {
      limitCount = parseInt(f.limitCount, 10);
      if (isNaN(limitCount) || limitCount < 1 || limitCount > 10) {
        return wx.showToast({ title: '次数限制需在1~10之间', icon: 'none' });
      }
    }
    // 随机范围仅「注册赠送」规则支持（抢红包效果），其他规则不校验也不保存
    let minPoints = 0, maxPoints = 0;
    if (name === '注册赠送' && (f.minPoints || f.maxPoints)) {
      minPoints = parseInt(f.minPoints, 10);
      maxPoints = parseInt(f.maxPoints, 10);
      if (isNaN(minPoints) || isNaN(maxPoints) || minPoints < 1 || maxPoints < minPoints) {
        return wx.showToast({ title: '随机范围不合法（最大值需大于等于最小值）', icon: 'none' });
      }
    }
    const maxQty = parseInt(f.maxQty, 10) || 1;
    if (maxQty < 1 || maxQty > 100) {
      return wx.showToast({ title: '单次可提交数量需在1~100之间', icon: 'none' });
    }
    const needSubmit = f.needSubmit !== false;
    const data = {
      name,
      description: (f.description || '').trim().slice(0, 50),
      points,
      needSubmit,
      // 无需用户提交的规则不配置周期/次数/数量（表单已隐藏，保存时强制清空）
      maxQty: needSubmit ? maxQty : 1,
      // 随机范围仅注册赠送保存，其他规则清空
      minPoints: name === '注册赠送' ? (minPoints || 0) : 0,
      maxPoints: name === '注册赠送' ? (maxPoints || 0) : 0,
      period: needSubmit ? f.period : '',
      limitCount: needSubmit && f.period ? limitCount : 0,
      status: f.status,
    };
    wx.showLoading({ title: '保存中' });
    try {
      // 规则名称不允许重复（新增和编辑都校验）
      const dup = this.data.rules.find(r => r.name === name && r._id !== this.data.editingRuleId);
      if (dup) {
        wx.hideLoading();
        return wx.showToast({ title: '规则名称已存在', icon: 'none' });
      }
      if (this.data.editingRuleId) {
        await pointsUtil.updateRule(this.data.editingRuleId, data);
      } else {
        await pointsUtil.addRule(data);
      }
      wx.hideLoading();
      wx.showToast({ title: '保存成功', icon: 'success' });
      this.setData({ showRuleForm: false });
      this.loadRules();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  async onDeleteRule(e) {
    const id = e.currentTarget.dataset.id;
    const r = this.data.rules.find(x => x._id === id);
    wx.showModal({
      title: '删除规则',
      content: '确定删除“' + (r ? r.name : '') + '”？删除后无法恢复。',
      confirmColor: '#ff4d4f',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await pointsUtil.deleteRule(id);
          wx.showToast({ title: '已删除', icon: 'success' });
          this.loadRules();
        } catch (err) {
          wx.showToast({ title: '删除失败', icon: 'none' });
        }
      },
    });
  },

  // ========== 审批 ==========
  async loadPending(reset) {
    const pageSize = 20;
    if (reset) {
      this.setData({ pendingSkip: 0, reviewedSkip: 0, pendingList: [], reviewedList: [], hasMorePending: false, hasMoreReviewed: false });
    }
    const { pendingSkip, reviewedSkip } = this.data;
    // 待审批：按 createTime 倒序分页
    const pendingRes = await dbUtil.db.collection('points_records')
      .where({ status: 'pending' })
      .orderBy('createTime', 'desc').skip(pendingSkip).limit(pageSize).get();
    const enriched = (await Promise.all(pendingRes.data.map(async (r) => this.enrichRecord(r)))).filter(Boolean);
    const newPending = reset ? enriched : [...this.data.pendingList, ...enriched];
    const hasMorePending = pendingRes.data.length >= pageSize;
    // 已审核：仅首次加载最近20条
    let newReviewed = this.data.reviewedList;
    let hasMoreReviewed = this.data.hasMoreReviewed;
    if (reset) {
      const reviewedRes = await dbUtil.db.collection('points_records')
        .where({ status: dbUtil._.neq('pending') })
        .orderBy('createTime', 'desc').limit(pageSize).get();
      const enrichedReviewed = (await Promise.all(reviewedRes.data.map(async (r) => this.enrichRecord(r)))).filter(Boolean);
      newReviewed = enrichedReviewed;
      hasMoreReviewed = reviewedRes.data.length >= pageSize;
    }
    this.setData({
      pendingList: newPending, reviewedList: newReviewed,
      pendingSkip: pendingSkip + pageSize,
      hasMorePending, hasMoreReviewed,
    });
  },

  async loadMorePending() {
    await this.loadPending(false);
  },

  async loadMoreReviewed() {
    const pageSize = 20;
    const skip = this.data.reviewedSkip + this.data.reviewedList.length;
    const reviewedRes = await dbUtil.db.collection('points_records')
      .where({ status: dbUtil._.neq('pending') })
      .orderBy('createTime', 'desc').skip(skip).limit(pageSize).get();
    const enrichedReviewed = (await Promise.all(reviewedRes.data.map(async (r) => this.enrichRecord(r)))).filter(Boolean);
    this.setData({
      reviewedList: [...this.data.reviewedList, ...enrichedReviewed],
      hasMoreReviewed: reviewedRes.data.length >= pageSize,
    });
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
      return { ...r, userName: u.data.nickName || '未知', imgUrls, fmtTime: this.fmtDate(r.createTime), fmtId: r._id.slice(-8), fmtPoints: r.points > 0 ? `+${r.points}` : `${Math.abs(r.points)}` };
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
    this.loadPending(true);
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
        const reason = (res.content || '').trim();
        if (!reason) {
          return wx.showToast({ title: '请填写驳回原因', icon: 'none' });
        }
        const reviewer = wx.getStorageSync('userInfo');
        await dbUtil.db.collection('points_records').doc(id).update({
          data: { status: 'rejected', rejectReason: reason, reviewerId: reviewer?._id, reviewTime: new Date() }
        });
        wx.showToast({ title: '已驳回', icon: 'success' });
        this.loadPending(true);
      }
    });
  },

  // ========== 手动录入/扣减 ==========
  /** 给用户列表附加积分展示字段（直接读 users.points 余额字段） */
  decorateUsers(list) {
    return (list || []).map(u => ({
      ...u,
      pointsNum: typeof u.points === 'number' ? u.points : 0,
      balanceText: `积分${typeof u.points === 'number' ? u.points : 0}`,
    }));
  },

  async loadUsers() {
    const res = await dbUtil.getUserList({}, 0, 20);
    const users = this.decorateUsers(res.data);
    this.setData({ users, filteredUsers: users });
  },

  onSearchUser(e) {
    const kw = e.detail.value || '';
    this.setData({ userFilter: kw });
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(async () => {
      if (kw) {
        const res = await dbUtil.getUserList({ nickName: dbUtil.db.RegExp({ regexp: kw, options: 'i' }) }, 0, 20);
        this.setData({ filteredUsers: this.decorateUsers(res.data) });
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
    const balancesObj = { ...(this.data.selectedUserBalances || {}) };
    if (ids[id]) {
      delete ids[id]; delete namesObj[id]; delete balancesObj[id];
    } else {
      ids[id] = true;
      namesObj[id] = name || '';
      const u = (this.data.filteredUsers || []).find(x => x._id === id);
      balancesObj[id] = (u && typeof u.points === 'number') ? u.points : 0;
    }
    const labels = Object.keys(ids).map(uid => {
      const nm = namesObj[uid];
      const bal = balancesObj[uid];
      return nm ? `${nm}（${bal != null ? bal : 0}分）` : '';
    }).filter(Boolean);
    const count = labels.length;
    const max = 5;
    let text = labels.slice(0, max).join('、');
    let more = '';
    if (count > max) {
      text += ' ...';
      more = `等${count}人`;
    }
    const all = labels.join('、');
    this.setData({
      selectedUserIds: ids,
      selectedUserNames: namesObj,
      selectedUserBalances: balancesObj,
      selectedCount: count,
      selectedNamesText: text,
      selectedNamesMore: more,
      selectedNamesAll: all,
      showAllNames: false,
    });
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

    // 扣减时检查余额：余额不足弹窗提醒（含当前实时余额）
    if (pts < 0) {
      const need = Math.abs(pts);
      const poor = [];
      for (const uid of userIds) {
        const balance = await pointsUtil.getBalance(uid);
        if (balance < need) {
          const nm = (this.data.selectedUserNames && this.data.selectedUserNames[uid]) || uid;
          poor.push(`${nm}（当前 ${balance} 分）`);
        }
      }
      if (poor.length > 0) {
        wx.showModal({
          title: '余额不足，无法扣减',
          content: `本次扣减 ${need} 分，以下用户余额不足：\n${poor.slice(0, 5).join('\n')}${poor.length > 5 ? `\n等 ${poor.length} 人` : ''}`,
          showCancel: false,
          confirmText: '知道了',
        });
        return;
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
      this.setData({ deductPoints: '', deductReason: '', deductImages: [], selectedUserIds: {}, selectedUserNames: {}, selectedUserBalances: {}, selectedCount: 0, selectedNamesText: '' });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  onPointsInput(e) {
    const v = String(e.detail.value || '').replace(/[^-\d]/g, '');
    const isNum = v !== '' && parseInt(v) !== 0;
    if (!isNum) {
      this.setData({ deductPoints: v, selectedUserIds: {}, selectedUserNames: {}, selectedUserBalances: {}, selectedCount: 0, selectedNamesText: '' });
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
