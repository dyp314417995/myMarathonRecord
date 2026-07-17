// pages/admin/lotteries/lotteries.js
Page({
  data: {
    lotteries: [],
    showForm: false,
    editingId: '',
    form: { name: '', timeStartDate: '', timeStartTime: '18:00', timeEndDate: '', timeEndTime: '18:00', codeCount: '', description: '', prizes: [] },
    submitting: false,
    isEditing: false,
    page: 0, pageSize: 20, hasMore: true,
    allLoaded: [],
    showCodes: false,
    codesList: [],
    codesTotal: 0,
    codesUsed: 0,
    showWinners: false,
    winnerList: [],
    winnerTitle: '',
  },

  onShow() {
    this.setData({ page: 0, allLoaded: [], hasMore: true });
    this.loadList();
  },

  onPullDownRefresh() {
    this.setData({ page: 0, allLoaded: [], hasMore: true });
    this.loadList().then(() => wx.stopPullDownRefresh());
  },

  async loadList(isLoadMore = false) {
    if (isLoadMore && !this.data.hasMore) return;
    wx.showLoading({ title: '加载中' });
    try {
      const userInfo = wx.getStorageSync('userInfo');
      const userId = userInfo ? (userInfo._id || userInfo.openid) : null;
      const res = await wx.cloud.callFunction({
        name: 'getLotteries',
        data: { action: 'all', userId, page: this.data.page + 1, pageSize: this.data.pageSize },
      });
      const result = res.result || {};
      const list = result.list || [];
      const merged = isLoadMore ? [...this.data.allLoaded, ...list] : list;
      this.setData({ allLoaded: merged, lotteries: merged, hasMore: result.hasMore || false });
    } catch (e) { console.error(e); }
    wx.hideLoading();
  },

  onLoadMore() {
    if (!this.data.hasMore) return;
    this.setData({ page: this.data.page + 1 }, () => this.loadList(true));
  },

  onHideForm() { this.setData({ showForm: false, isEditing: false }); },

  // 工具：拆分 Date 为 { date, time }
  _splitDate(d) {
    if (!d) return { date: '', time: '18:00' };
    const dt = new Date(d);
    const date = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
    const time = `${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
    return { date, time };
  },

  async _loadDetail(id) {
    const res = await wx.cloud.callFunction({ name: 'getLotteries', data: { action: 'detail', id } });
    return res.result;
  },

  onAdd() {
    this.setData({
      showForm: true, editingId: '', isEditing: false,
      form: {
        name: '', timeStartDate: '', timeStartTime: '18:00',
        timeEndDate: '', timeEndTime: '18:00',
        codeCount: '', description: '', prizes: [{ name: '', count: '' }],
      },
    });
  },

  // 编辑（仅时间可改）
  async onEdit(e) {
    wx.showLoading({ title: '加载中' });
    const detail = await this._loadDetail(e.currentTarget.dataset.id);
    wx.hideLoading();
    if (!detail || detail.error) return wx.showToast({ title: '加载失败', icon: 'none' });

    const st = this._splitDate(detail.timeStart);
    const et = this._splitDate(detail.timeEnd);

    this.setData({
      showForm: true, editingId: detail._id, isEditing: true,
      form: {
        name: detail.name || '',
        timeStartDate: st.date, timeStartTime: st.time,
        timeEndDate: et.date, timeEndTime: et.time,
        codeCount: String(detail.codeCount || ''),
        description: detail.description || '',
        prizes: (detail.prizes || []).map(p => ({ name: p.name, count: String(p.count) })),
      },
    });
  },

  // 复制
  async onCopy(e) {
    wx.showLoading({ title: '加载中' });
    const detail = await this._loadDetail(e.currentTarget.dataset.id);
    wx.hideLoading();
    if (!detail || detail.error) return wx.showToast({ title: '加载失败', icon: 'none' });

    const st = this._splitDate(detail.timeStart);
    const et = this._splitDate(detail.timeEnd);

    this.setData({
      showForm: true, editingId: '', isEditing: false,
      form: {
        name: (detail.name || '') + '（副本）',
        timeStartDate: st.date, timeStartTime: st.time,
        timeEndDate: et.date, timeEndTime: et.time,
        codeCount: String(detail.codeCount || ''),
        description: detail.description || '',
        prizes: (detail.prizes || []).map(p => ({ name: p.name, count: String(p.count) })),
      },
    });
  },

  onViewDetail(e) {
    wx.navigateTo({ url: `/pages/tools/activity/lottery-detail?id=${e.currentTarget.dataset.id}` });
  },

  onInput(e) {
    const { k } = e.currentTarget.dataset;
    this.setData({ ['form.' + k]: e.detail.value });
  },

  onDate(e) {
    const { k } = e.currentTarget.dataset;
    this.setData({ ['form.' + k]: e.detail.value });
  },

  // 奖品操作
  onPrizeInput(e) {
    const { idx, field } = e.currentTarget.dataset;
    const key = `form.prizes[${idx}].${field}`;
    this.setData({ [key]: e.detail.value });
  },

  onAddPrize() {
    const prizes = [...this.data.form.prizes, { name: '', count: '' }];
    this.setData({ 'form.prizes': prizes });
  },

  onDelPrize(e) {
    const prizes = [...this.data.form.prizes];
    prizes.splice(e.currentTarget.dataset.idx, 1);
    this.setData({ 'form.prizes': prizes });
  },

  async onSave() {
    const f = this.data.form;
    if (!f.name.trim()) return wx.showToast({ title: '请输入抽奖名称', icon: 'none' });

    const buildDT = (date, time) => date ? new Date(date + ' ' + (time || '00:00')) : null;

    const timeNow = new Date();
    const startTime = buildDT(f.timeStartDate, f.timeStartTime);
    const endTime = buildDT(f.timeEndDate, f.timeEndTime);

    if (startTime && startTime < timeNow) return wx.showToast({ title: '开始时间不能早于当前时间', icon: 'none' });
    if (endTime && startTime && endTime <= startTime) return wx.showToast({ title: '结束时间必须晚于开始时间', icon: 'none' });

    if (this.data.editingId) {
      // 编辑：只修改时间 + 名称/说明
      const data = {
        name: f.name.trim(),
        timeStart: buildDT(f.timeStartDate, f.timeStartTime),
        timeEnd: buildDT(f.timeEndDate, f.timeEndTime),
        description: f.description || '',
      };
      this.setData({ submitting: true });
      wx.showLoading({ title: '保存中' });
      try {
        await wx.cloud.callFunction({
          name: 'getLotteries',
          data: { action: 'update', id: this.data.editingId, data },
        });
        wx.hideLoading();
        wx.showToast({ title: '修改成功', icon: 'success' });
        this.setData({ showForm: false, submitting: false, isEditing: false });
        this.onShow();
      } catch (e) {
        wx.hideLoading();
        console.error(e);
        wx.showToast({ title: '保存失败', icon: 'none' });
        this.setData({ submitting: false });
      }
      return;
    }

    // 新建
    if (!f.codeCount || parseInt(f.codeCount) < 1) return wx.showToast({ title: '请输入有效的抽奖码数量', icon: 'none' });
    const prizes = f.prizes.filter(p => p.name.trim() && parseInt(p.count) > 0);
    if (!prizes.length) return wx.showToast({ title: '请至少设置一个有效的奖品', icon: 'none' });

    this.setData({ submitting: true });
    wx.showLoading({ title: '保存中' });
    try {
      const userInfo = wx.getStorageSync('userInfo');
      const userId = userInfo ? (userInfo._id || userInfo.openid) : null;

      const data = {
        name: f.name.trim(),
        timeStart: buildDT(f.timeStartDate, f.timeStartTime),
        timeEnd: buildDT(f.timeEndDate, f.timeEndTime),
        codeCount: parseInt(f.codeCount),
        prizes: prizes.map(p => ({ name: p.name.trim(), count: parseInt(p.count) })),
        description: f.description || '',
      };

      const res = await wx.cloud.callFunction({
        name: 'getLotteries',
        data: { action: 'create', data, userId },
      });
      wx.hideLoading();
      if (res.result && res.result.error) {
        wx.showToast({ title: res.result.error, icon: 'none' });
      } else {
        wx.showToast({ title: `已生成 ${res.result.codeCount} 个抽奖码`, icon: 'success' });
        this.setData({ showForm: false, submitting: false });
        this.onShow();
      }
    } catch (e) {
      wx.hideLoading();
      console.error(e);
      wx.showToast({ title: '保存失败', icon: 'none' });
      this.setData({ submitting: false });
    }
  },

  async onCancel(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '取消抽奖', content: '确定取消？', confirmColor: '#ff4d4f',
      success: async (res) => {
        if (!res.confirm) return;
        await wx.cloud.callFunction({ name: 'getLotteries', data: { action: 'cancel', id } });
        wx.showToast({ title: '已取消', icon: 'success' });
        this.onShow();
      },
    });
  },

  async onDraw(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '确认开奖',
      content: '将从所有参与用户中随机抽取并分配奖品，确定开奖？',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '开奖中...' });
        try {
          const r = await wx.cloud.callFunction({ name: 'getLotteries', data: { action: 'draw', id } });
          wx.hideLoading();
          const result = r.result || {};
          if (result.error) {
            wx.showToast({ title: result.error, icon: 'none' });
          } else {
            wx.showToast({ title: `开奖完成！${result.winnerCount} 人中奖`, icon: 'success' });
            this.onShow();
          }
        } catch (e) {
          wx.hideLoading();
          console.error(e);
          wx.showToast({ title: '开奖失败', icon: 'none' });
        }
      },
    });
  },

  async onDelete(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除抽奖', content: '将同时删除所有抽奖码，不可恢复', confirmColor: '#ff4d4f',
      success: async (res) => {
        if (!res.confirm) return;
        await wx.cloud.callFunction({ name: 'getLotteries', data: { action: 'delete', id } });
        wx.showToast({ title: '已删除', icon: 'success' });
        this.onShow();
      },
    });
  },

  async onViewCodes(e) {
    const id = e.currentTarget.dataset.id;
    wx.showLoading({ title: '加载中' });
    try {
      const res = await wx.cloud.callFunction({ name: 'getLotteries', data: { action: 'codes', id } });
      const result = res.result || {};
      this.setData({
        showCodes: true,
        codesList: result.list || [],
        codesTotal: result.total || 0,
        codesUsed: result.usedCount || 0,
      });
    } catch (e) { console.error(e); }
    wx.hideLoading();
  },

  onHideCodes() { this.setData({ showCodes: false }); },

  onCopyCodes() {
    const codes = this.data.codesList.map(c => c.code);
    const text = codes.join('\n');
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: `已复制 ${codes.length} 个码`, icon: 'success' }),
    });
  },

  async onViewWinners(e) {
    const item = this.data.lotteries.find(x => x._id === e.currentTarget.dataset.id);
    if (!item || !item.winners || !item.winners.length) {
      return wx.showToast({ title: '暂无中奖信息', icon: 'none' });
    }

    // 加载用户昵称
    const db = wx.cloud.database();
    const _ = db.command;
    const userIds = [...new Set(item.winners.map(w => w.userId))];
    const userMap = {};
    try {
      const userRes = await db.collection('users')
        .where({ _id: _.in(userIds) })
        .field({ _id: true, nickName: true })
        .get();
      userRes.data.forEach(u => { userMap[u._id] = u.nickName || '未知'; });
    } catch (e) { console.error(e); }

    // 按奖品分组展示
    const prizeGroups = {};
    item.winners.forEach(w => {
      if (!prizeGroups[w.prizeName]) prizeGroups[w.prizeName] = [];
      prizeGroups[w.prizeName].push({
        userId: w.userId,
        userName: userMap[w.userId] || '未知',
        winningCode: w.winningCode || '',
      });
    });

    const winnerList = Object.entries(prizeGroups).map(([name, users]) => ({
      name,
      count: users.length,
      users,
    }));

    this.setData({
      showWinners: true,
      winnerTitle: `${item.winners.length} 人中奖`,
      winnerList,
    });
  },

  onHideWinners() { this.setData({ showWinners: false }); },
});
