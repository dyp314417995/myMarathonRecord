// pages/admin/activities/activities.js
Page({
  data: {
    activities: [],
    showForm: false,
    editingId: '',
    form: { name: '', timeStart: '', timeEnd: '', location: '', fee: '', deadline: '', maxPeople: '', images: [], description: '', customFields: [] },
    tmpImages: [],
    submitting: false,
  },

  async onShow() {
    wx.showLoading({ title: '加载中' });
    try {
      const res = await wx.cloud.callFunction({ name: 'getActivities', data: { action: 'all' } });
      this.setData({ activities: (res.result || {}).list || [] });
    } catch (e) { console.error(e); }
    wx.hideLoading();
  },

  onHideForm() { this.setData({ showForm: false }); },
  onAdd() {
    this.setData({
      showForm: true, editingId: '', tmpImages: [],
      form: { name: '', timeStart: '', timeEnd: '', location: '', fee: '', deadline: '', maxPeople: '', images: [], description: '', customFields: [] },
    });
  },

  onEdit(e) {
    const a = this.data.activities.find(x => x._id === e.currentTarget.dataset.id);
    if (!a) return;
    this.setData({
      showForm: true, editingId: a._id, tmpImages: a.images || [],
      form: { ...a },
    });
  },

  onInput(e) {
    const { k } = e.currentTarget.dataset;
    this.setData({ ['form.' + k]: e.detail.value });
  },
  onDate(e) {
    const { k } = e.currentTarget.dataset;
    this.setData({ ['form.' + k]: e.detail.value });
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
    if (!f.timeStart) return wx.showToast({ title: '请选择开始时间', icon: 'none' });

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

    try {
      if (this.data.editingId) {
        await wx.cloud.callFunction({ name: 'getActivities', data: { action: 'update', id: this.data.editingId, data } });
      } else {
        await wx.cloud.callFunction({ name: 'getActivities', data: { action: 'create', data } });
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

  fmtDate(d) {
    if (!d) return '';
    const dt = new Date(d);
    return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
  },
});
