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
    this.setData({ page: 0, allLoaded: [], hasMore: true });
    this.loadActivities();
  },

  async loadActivities(isLoadMore = false) {
    if (isLoadMore && !this.data.hasMore) return;
    wx.showLoading({ title: '加载中' });
    try {
      const skip = this.data.page * this.data.pageSize;
      const res = await wx.cloud.callFunction({ name: 'getActivities', data: { action: 'all', skip, limit: this.data.pageSize } });
      const result = res.result || {};
      const list = result.list || [];
      list.forEach(item => {
        item._fmtStart = this.fmtDate(item.timeStart);
        item._fmtEnd = item.timeEnd ? this.fmtDate(item.timeEnd) : '';
      });
      const merged = isLoadMore ? [...this.data.allLoaded, ...list] : list;
      this.setData({ allLoaded: merged, hasMore: result.hasMore || false });
      this.applyFilter();
    } catch (e) { console.error(e); }
    wx.hideLoading();
  },

  onLoadMore() {
    if (!this.data.hasMore) return;
    this.setData({ page: this.data.page + 1 }, () => this.loadActivities(true));
  },

  applyFilter() {
    const { allLoaded, filterStatusIdx, statusOptions } = this.data;
    const now = new Date();
    const thisYear = now.getFullYear();
    let list = allLoaded.filter(a => {
      const ts = a.timeStart ? new Date(a.timeStart) : null;
      return ts && ts.getFullYear() === thisYear;
    });
    if (filterStatusIdx > 0) {
      const tag = statusOptions[filterStatusIdx];
      list = list.filter(a => a.stateTag && a.stateTag.text === tag);
    }
    // 按最近时间节点排序（截止/开始取最近的）
    list.sort((a, b) => {
      const na = Math.min(
        a.deadline && new Date(a.deadline) > now ? new Date(a.deadline) : Infinity,
        new Date(a.timeStart) > now ? new Date(a.timeStart) : Infinity
      );
      const nb = Math.min(
        b.deadline && new Date(b.deadline) > now ? new Date(b.deadline) : Infinity,
        new Date(b.timeStart) > now ? new Date(b.timeStart) : Infinity
      );
      return na - nb;
    });
    const end = (this.data.page + 1) * this.data.pageSize;
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
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const fmtT = (d) => `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    // 默认开始=现在；结束=明天同一时刻；截止=结束前一小时
    const end = new Date(now.getTime() + 24 * 3600 * 1000);
    const deadline = new Date(end.getTime() - 3600 * 1000);
    this.setData({
      showForm: true, editingId: '', tmpImages: [],
      form: {
        name: '', location: '', fee: '', maxPeople: '', images: [], description: '', customFields: [],
        timeStartDate: fmt(now), timeStartTime: fmtT(now),
        timeEndDate: fmt(end), timeEndTime: fmtT(end),
        deadlineDate: fmt(deadline), deadlineTime: fmtT(deadline),
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
    // 自定义字段 options 还原为 optionsStr
    const fields = (a.customFields || []).map(f => ({
      ...f,
      optionsStr: (f.options || []).join('，'),
    }));
    this.setData({
      showForm: true, editingId: a._id, tmpImages: a.images || [],
      form: {
        name: a.name || '', location: a.location || '', fee: a.fee || '',
        maxPeople: a.maxPeople || '', description: a.description || '',
        customFields: fields,
        timeStartDate: toT(a.timeStart), timeStartTime: toTi(a.timeStart),
        timeEndDate: toT(a.timeEnd), timeEndTime: toTi(a.timeEnd),
        deadlineDate: toT(a.deadline), deadlineTime: toTi(a.deadline),
        images: a.images || [],
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
    const f = this.data.form;
    // 时间联动：开始 → 结束（+24h）、截止（结束 -1h）
    if (k === 'timeStartTime' || k === 'timeStartDate') {
      const parse = (d, t) => {
        const [Y, M, D] = d.split('-').map(Number);
        const [h, m] = (t || '00:00').split(':').map(Number);
        return new Date(Y, M - 1, D, h, m);
      };
      const start = parse(f.timeStartDate, f.timeStartTime);
      const end = new Date(start.getTime() + 24 * 3600 * 1000);
      const deadline = new Date(end.getTime() - 3600 * 1000);
      const fmtD = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      const fmtT = (d) => `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      updates['form.timeEndDate'] = fmtD(end);
      updates['form.timeEndTime'] = fmtT(end);
      updates['form.deadlineDate'] = fmtD(deadline);
      updates['form.deadlineTime'] = fmtT(deadline);
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

    const buildDateTime = (date, time) => {
      if (!date) return null;
      const d = date + ' ' + (time || '00:00');
      return new Date(d);
    };
    const startTime = buildDateTime(f.timeStartDate, f.timeStartTime);
    const endTime = buildDateTime(f.timeEndDate, f.timeEndTime);
    const timeNow = new Date();

    if (startTime && startTime < timeNow) return wx.showToast({ title: '开始时间不能早于当前时间', icon: 'none' });
    if (endTime && startTime && endTime <= startTime) return wx.showToast({ title: '结束时间必须晚于开始时间', icon: 'none' });

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
      wx.showLoading({ title: '发放中' });
      const r = await wx.cloud.callFunction({ name: 'getActivities', data: { action: 'finish', id } });
      wx.hideLoading();
      const result = (r && r.result) || {};
      const { awarded = 0, failed = 0, total = 0 } = result;
      let title;
      if (total === 0) title = '已无待发放报名';
      else if (failed === 0) title = `已完成，发放 ${awarded} 人`;
      else title = `已完成，发放 ${awarded}/${total}（${failed} 失败）`;
      wx.showModal({ title, content: failed > 0 ? '请前往云开发控制台查看活动报名 userId 是否与 users._id 一致' : '', showCancel: false, confirmText: '知道了' });
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

  onViewDetail(e) {
    wx.navigateTo({ url: `/pages/tools/activity/detail?id=${e.currentTarget.dataset.id}&from=admin` });
  },

  fmtDate(d) {
    if (!d) return '';
    const dt = new Date(d);
    return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
  },
});
