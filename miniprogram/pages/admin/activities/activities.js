// pages/admin/activities/activities.js
Page({
  data: {
    activities: [],
    showForm: false,
    editingId: '',
    form: { name: '', timeStart: '', timeEnd: '', location: '', fee: '', deadline: '', maxPeople: '', images: [], description: '', customFields: [] },
    tmpImages: [],
    submitting: false,
    // 分页筛选
    page: 0, pageSize: 20, hasMore: true,
    filterStatusIdx: 0, statusOptions: ['全部状态', '报名中', '进行中', '已截止', '已完成', '已取消'],
    allLoaded: [], // 全量缓存用于前端筛选
  },

  async onShow() {
    wx.showLoading({ title: '加载中' });
    try {
      const res = await wx.cloud.callFunction({ name: 'getActivities', data: { action: 'all', skip: 0, limit: 100 } });
      const list = (res.result || {}).list || [];
      list.forEach(item => { item._fmtStart = this.fmtDate(item.timeStart); });
      this.setData({ allLoaded: list, page: 1 });
      this.applyFilter();
    } catch (e) { console.error(e); }
    wx.hideLoading();
  },

  applyFilter() {
    const { allLoaded, filterStatusIdx, statusOptions } = this.data;
    const thisYear = new Date().getFullYear();
    let list = allLoaded.filter(a => {
      const ts = a.timeStart ? new Date(a.timeStart) : null;
      return ts && ts.getFullYear() === thisYear;
    });
    if (filterStatusIdx > 0) {
      const tag = statusOptions[filterStatusIdx];
      list = list.filter(a => a.stateTag && a.stateTag.text === tag);
    }
    const end = this.data.page * this.data.pageSize;
    const sliced = list.slice(0, end);
    this.setData({ activities: sliced, hasMore: end < list.length });
  },

  async onLoadMore() {
    this.setData({ page: this.data.page + 1 });
    this.applyFilter();
  },

  onFilterStatus(e) {
    this.setData({ filterStatusIdx: e.currentTarget.dataset.idx, page: 1 });
    this.applyFilter();
  },

  onHideForm() { this.setData({ showForm: false }); },
  onAdd() {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    // 默认开始 7:00，结束 9:00，截止 6:00
    this.setData({
      showForm: true, editingId: '', tmpImages: [],
      form: {
        name: '', location: '', fee: '', maxPeople: '', images: [], description: '', customFields: [],
        timeStartDate: today, timeStartTime: '07:00',
        timeEndDate: today, timeEndTime: '09:00',
        deadlineDate: today, deadlineTime: '06:00',
      },
    });
  },

  onCopy(e) {
    const a = this.data.activities.find(x => x._id === e.currentTarget.dataset.id);
    if (!a) return;
    const toT = (d) => {
      if (!d) return '';
      const dt = new Date(d);
      return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
    };
    const toTi = (d) => {
      if (!d) return '07:00';
      const dt = new Date(d);
      return `${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
    };
    this.setData({
      showForm: true, editingId: '', tmpImages: a.images || [],
      form: {
        name: a.name + '（副本）', location: a.location || '', fee: a.fee || '',
        maxPeople: a.maxPeople || '', description: a.description || '',
        customFields: JSON.parse(JSON.stringify(a.customFields || [])),
        timeStartDate: toT(a.timeStart), timeStartTime: toTi(a.timeStart),
        timeEndDate: toT(a.timeEnd), timeEndTime: toTi(a.timeEnd),
        deadlineDate: toT(a.deadline), deadlineTime: toTi(a.deadline),
        images: a.images || [],
      },
    });
  },

  onEdit(e) {
    const a = this.data.activities.find(x => x._id === e.currentTarget.dataset.id);
    if (!a) return;
    const toT = (d) => {
      if (!d) return '';
      const dt = new Date(d);
      return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
    };
    const toTi = (d) => {
      if (!d) return '07:00';
      const dt = new Date(d);
      return `${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
    };
    this.setData({
      showForm: true, editingId: a._id, tmpImages: a.images || [],
      form: {
        ...a,
        timeStartDate: toT(a.timeStart), timeStartTime: toTi(a.timeStart),
        timeEndDate: toT(a.timeEnd), timeEndTime: toTi(a.timeEnd),
        deadlineDate: toT(a.deadline), deadlineTime: toTi(a.deadline),
      },
    });
  },

  onInput(e) {
    const { k } = e.currentTarget.dataset;
    this.setData({ ['form.' + k]: e.detail.value });
  },
  onDate(e) {
    const { k } = e.currentTarget.dataset;
    const updates = { ['form.' + k]: e.detail.value };
    // 开始时间变化 → 自动调整结束和截止
    if (k === 'timeStartTime') {
      const [h, m] = e.detail.value.split(':').map(Number);
      // 结束 = 开始 + 2h
      const endH = (h + 2) % 24;
      updates['form.timeEndTime'] = `${String(endH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      updates['form.timeEndDate'] = this.data.form.timeStartDate;
      // 截止 = 开始 - 1h
      let deadH = h - 1, deadDate = this.data.form.timeStartDate;
      if (deadH < 0) { deadH = 23; }
      updates['form.deadlineTime'] = `${String(deadH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      updates['form.deadlineDate'] = deadDate;
    }
    if (k === 'timeStartDate') {
      updates['form.timeEndDate'] = e.detail.value;
      updates['form.deadlineDate'] = e.detail.value;
    }
    this.setData(updates);
  },

  onChooseImage() {
    wx.chooseMedia({ count: 3, mediaType: ['image'], success: (res) => {
      this.setData({ tmpImages: [...this.data.tmpImages, ...res.tempFiles.map(f => f.tempFilePath)] });
    }});
  },

  onRemoveImage(e) {
    const arr = [...this.data.tmpImages]; arr.splice(e.currentTarget.dataset.idx, 1);
    this.setData({ tmpImages: arr });
  },

  // 自定义字段
  onAddField() {
    if (this.data.form.customFields.length >= 5) {
      return wx.showToast({ title: '最多5个自定义字段', icon: 'none' });
    }
    this.setData({ 'form.customFields': [...this.data.form.customFields, { label: '', type: 'text', required: false, options: [] }] });
  },
  onDelField(e) {
    const arr = [...this.data.form.customFields]; arr.splice(e.currentTarget.dataset.idx, 1);
    this.setData({ 'form.customFields': arr });
  },
  onFieldInput(e) {
    const { idx, key } = e.currentTarget.dataset;
    const arr = [...this.data.form.customFields];
    arr[idx] = { ...arr[idx], [key]: e.detail.value };
    this.setData({ 'form.customFields': arr });
  },
  onFieldType(e) {
    const { idx, v } = e.currentTarget.dataset;
    const arr = [...this.data.form.customFields];
    arr[idx] = { ...arr[idx], type: v };
    this.setData({ 'form.customFields': arr });
  },
  onFieldRequired(e) {
    const { idx } = e.currentTarget.dataset;
    const arr = [...this.data.form.customFields];
    arr[idx] = { ...arr[idx], required: !arr[idx].required };
    this.setData({ 'form.customFields': arr });
  },

  async onSave() {
    const f = this.data.form;
    if (!f.name.trim()) return wx.showToast({ title: '请输入活动名称', icon: 'none' });
    if (!f.timeStartDate) return wx.showToast({ title: '请选择开始日期', icon: 'none' });
    if (!f.timeStartTime) return wx.showToast({ title: '请选择开始时间', icon: 'none' });

    this.setData({ submitting: true });
    wx.showLoading({ title: '保存中' });

    // 上传图片
    const images = [...f.images];
    for (const tmp of this.data.tmpImages) {
      if (tmp.startsWith('cloud://')) { if (!images.includes(tmp)) images.push(tmp); continue; }
      try {
        const up = await wx.cloud.uploadFile({ cloudPath: `activities/${Date.now()}-${Math.random().toString(36).slice(2)}.png`, filePath: tmp });
        images.push(up.fileID);
      } catch {}
    }

    const buildDateTime = (date, time) => {
      if (!date) return null;
      const d = date + ' ' + (time || '00:00');
      return new Date(d);
    };
    const data = {
      name: f.name.trim(),
      timeStart: buildDateTime(f.timeStartDate, f.timeStartTime),
      timeEnd: buildDateTime(f.timeEndDate, f.timeEndTime),
      location: f.location || '', fee: f.fee || '',
      deadline: buildDateTime(f.deadlineDate, f.deadlineTime),
      maxPeople: parseInt(f.maxPeople) || null, images,
      description: f.description || '',
      customFields: (f.customFields || []).map(cf => ({ label: cf.label, type: cf.type, required: cf.required, options: (cf.optionsStr || '').split(/[,，]/).map(s => s.trim()).filter(Boolean) })),
    };

    let result;
    try {
      if (this.data.editingId) {
        result = await wx.cloud.callFunction({ name: 'getActivities', data: { action: 'update', id: this.data.editingId, data } });
      } else {
        result = await wx.cloud.callFunction({ name: 'getActivities', data: { action: 'create', data } });
        // 新活动生成小程序码
        const qrRes = await wx.cloud.callFunction({ name: 'genActivityQR', data: { activityId: result.result._id } });
        if (qrRes.result && qrRes.result.fileID) {
          await wx.cloud.callFunction({ name: 'getActivities', data: { action: 'update', id: result.result._id, data: { qrcode: qrRes.result.fileID } } });
        }
      }
      wx.hideLoading();
      wx.showToast({ title: '保存成功', icon: 'success' });
      this.setData({ showForm: false, submitting: false });
      this.onShow();
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '保存失败', icon: 'none' });
      this.setData({ submitting: false });
    }
  },

  async onCancel(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({ title: '取消活动', content: '取消后所有报名将失效', confirmColor: '#ff4d4f', success: async (res) => {
      if (!res.confirm) return;
      await wx.cloud.callFunction({ name: 'getActivities', data: { action: 'cancel', id } });
      wx.showToast({ title: '已取消', icon: 'success' });
      this.onShow();
    }});
  },

  async onFinish(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({ title: '完成活动', content: '确认后将发放积分', success: async (res) => {
      if (!res.confirm) return;
      await wx.cloud.callFunction({ name: 'getActivities', data: { action: 'finish', id } });
      wx.showToast({ title: '已完成', icon: 'success' });
      this.onShow();
    }});
  },

  async onDelete(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({ title: '删除活动', content: '不可恢复', confirmColor: '#ff4d4f', success: async (res) => {
      if (!res.confirm) return;
      await wx.cloud.callFunction({ name: 'getActivities', data: { action: 'delete', id } });
      wx.showToast({ title: '已删除', icon: 'success' });
      this.onShow();
    }});
  },

  async onRegistrations(e) {
    const id = e.currentTarget.dataset.id;
    wx.showLoading({ title: '加载中' });
    const res = await wx.cloud.callFunction({ name: 'getActivities', data: { action: 'registrations', id } });
    wx.hideLoading();
    this.setData({ showRegs: true, regList: (res.result || {}).list || [], regActId: id });
  },
  onHideRegs() { this.setData({ showRegs: false }); },
  async onShare(e) {
    const { id, qr } = e.currentTarget.dataset;
    if (qr) {
      this.setData({ showQR: true, qrImage: qr });
      return;
    }
    wx.showLoading({ title: '生成中' });
    const res = await wx.cloud.callFunction({ name: 'genActivityQR', data: { activityId: id } });
    wx.hideLoading();
    if (res.result && res.result.fileID) {
      await wx.cloud.callFunction({ name: 'getActivities', data: { action: 'update', id, data: { qrcode: res.result.fileID } } });
      this.setData({ showQR: true, qrImage: res.result.fileID });
      this.onShow();
    } else {
      wx.showToast({ title: '生成失败', icon: 'none' });
    }
  },
  onHideQR() { this.setData({ showQR: false }); },

  onViewDetail(e) {
    wx.navigateTo({ url: `/pages/tools/activity/detail?id=${e.currentTarget.dataset.id}` });
  },

  fmtDate(d) {
    if (!d) return '';
    const dt = new Date(d);
    return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
  },
});
