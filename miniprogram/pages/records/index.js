// pages/records/index.js - 跑马记录
const dbUtil = require('../../utils/db');
const db = dbUtil.db;

Page({
  data: {
    tab: 'full',
    records: [],
    filteredRecords: [],
    showForm: false,
    editingId: '',
    // 表单数据
    form: { raceType: 'full', raceLevel: 'B', status: 'finished', date: '', city: '', result: '', distance: '', elevation: '', itra: '', certs: { itra: false, utmb: false, utmbws: false }, note: '', isPublic: true },
    formImages: [],
    showTimePicker: false,
    showChart: false,
    chartTips: '',
  },

  onShow() { this.loadRecords(); },

  async loadRecords() {
    const u = wx.getStorageSync('userInfo');
    const userId = u?._id;
    if (!userId) return;
    const res = await db.collection('race_records').where({ userId }).orderBy('date', 'desc').get();
    const records = res.data.map(r => ({
      ...r,
      imgUrls: [],
    }));
    // 转换图片
    const allCloudIds = records.reduce((arr, r) => arr.concat(r.images || []), []);
    const urlMap = {};
    for (let i = 0; i < allCloudIds.length; i += 50) {
      try {
        const batch = allCloudIds.slice(i, i + 50);
        const r = await wx.cloud.callFunction({ name: 'getImageUrls', data: { fileIDs: batch } });
        (r.result || []).forEach(f => { if (f.tempFileURL) urlMap[f.fileID] = f.tempFileURL; });
      } catch {}
    }
    // 标记当前 PB
    const toSec = (t) => { const p = (t||'').split(':'); return +p[0]*3600 + +p[1]*60 + +(p[2]||0); };
    const pbFields = { '10k': u?.pb10k, half: u?.pbHalf, full: u?.pbFull };
    records.forEach(r => {
      r.imgUrls = (r.images || []).map(id => urlMap[id] || '').filter(Boolean);
      r.isPB = r.status === 'finished' && r.result && toSec(r.result) <= toSec(pbFields[r.raceType]) && r.result === pbFields[r.raceType];
    });
    this.setData({ records });
    this.updateFiltered();
    this.updateChart();
  },

  // 切换 Tab
  onTab(e) {
    this.setData({ tab: e.currentTarget.dataset.t, showForm: false });
    this.updateFiltered();
    this.updateChart();
  },

  updateFiltered() {
    const tab = this.data.tab;
    const filtered = this.data.records.filter(r => {
      if (tab === '10k') return r.raceType === '10k';
      if (tab === 'half') return r.raceType === 'half';
      if (tab === 'trail') return r.raceType === 'trail';
      return r.raceType === 'full';
    });
    this.setData({ filteredRecords: filtered });
  },

  // 成绩变化
  updateChart() {
    const finished = this.data.filteredRecords.filter(r => r.status === 'finished' && r.result);
    if (finished.length < 2) {
      this.setData({ showChart: false, chartData: [] });
      return;
    }
    const toSec = (t) => { const p = t.split(':'); return +p[0]*3600 + +p[1]*60 + +(p[2]||0); };
    const pb = finished.reduce((best, r) => toSec(r.result) < toSec(best.result) ? r : best, finished[0]);
    const maxSec = Math.max(...finished.map(r => toSec(r.result)));
    const entries = finished
      .slice(0, 10) // 最多10条
      .reverse()
      .map(r => ({
        date: r.date, city: r.city, result: r.result,
        isPB: r._id === pb._id,
        width: Math.max(((toSec(r.result) / maxSec) * 100), 30),
      }));
    this.setData({ showChart: true, chartData: entries });
  },

  // 添加
  onAdd() {
    const defaults = { '10k': '0:50:30', half: '2:00:00', full: '3:30:00', trail: '5:00:00' };
    this.setData({
      showForm: true, editingId: '',
      form: { raceType: this.data.tab, raceLevel: 'A', status: 'finished', date: '', city: '', result: defaults[this.data.tab] || '3:30:00', distance: '', elevation: '', itra: '', certs: { itra: false, utmb: false, utmbws: false }, note: '', isPublic: true },
      formImages: [],
    });
  },

  // 编辑
  onEdit(e) {
    const r = this.data.records.find(x => x._id === e.currentTarget.dataset.id);
    if (!r) return;
    this.setData({
      showForm: true, editingId: r._id,
      form: { raceType: r.raceType, raceLevel: r.raceLevel, status: r.status, date: r.date, city: r.city, result: r.result || '', distance: r.distance || '', elevation: r.elevation || '', itra: r.itra || '', certs: r.certs || { itra: false, utmb: false, utmbws: false }, note: r.note || '', isPublic: r.isPublic !== false },
      formImages: (r.images || []).map(id => ({ cloudID: id, local: '' })),
    });
  },

  // 删除
  onDel(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({ title: '删除记录', content: '确定删除？', confirmColor: '#ff4d4f', success: async (r) => {
      if (!r.confirm) return;
      await db.collection('race_records').doc(id).remove();
      wx.showToast({ title: '已删除', icon: 'success' });
      this.loadRecords();
    }});
  },

  // 表单变更
  onFormType(e) { this.setData({ 'form.raceType': e.currentTarget.dataset.v }); },
  onFormLevel(e) { this.setData({ 'form.raceLevel': e.currentTarget.dataset.v }); },
  onToggleCert(e) {
    const k = e.currentTarget.dataset.k;
    const certs = { ...this.data.form.certs, [k]: !this.data.form.certs[k] };
    this.setData({ 'form.certs': certs });
  },
  onFormStatus(e) { this.setData({ 'form.status': e.currentTarget.dataset.v }); },
  onFormInput(e) { this.setData({ [`form.${e.currentTarget.dataset.k}`]: e.detail.value }); },
  onFormPublic() { this.setData({ 'form.isPublic': !this.data.form.isPublic }); },

  onDateChange(e) { this.setData({ 'form.date': e.detail.value }); },
  onPickTime() { this.setData({ showTimePicker: true }); },
  onTimeChange(e) { this.setData({ 'form.result': e.detail.value, showTimePicker: false }); },

  onImageAdd() {
    wx.chooseMedia({ count: 9 - this.data.formImages.length, mediaType: ['image'], success: (res) => {
      const imgs = [...this.data.formImages, ...res.tempFiles.map(f => ({ local: f.tempFilePath, cloudID: '' }))];
      this.setData({ formImages: imgs });
    }});
  },
  onImageDel(e) {
    const imgs = this.data.formImages.filter((_, i) => i !== e.currentTarget.dataset.idx);
    this.setData({ formImages: imgs });
  },
  onImagePreview(e) {
    wx.previewImage({ urls: this.data.formImages.map(f => f.local || f.cloudID), current: e.currentTarget.dataset.src });
  },

  onHideForm() { this.setData({ showForm: false }); },
  onHideTime() { this.setData({ showTimePicker: false }); },

  // 保存
  async onSave() {
    const f = this.data.form;

    if (!f.date) return wx.showToast({ title: '请选日期', icon: 'none' });
    if (f.status === 'finished' && !f.result) return wx.showToast({ title: '请填写成绩', icon: 'none' });
    wx.showLoading({ title: '保存中' });
    // 上传新图片
    const images = [];
    for (const img of this.data.formImages) {
      if (img.local) {
        const up = await wx.cloud.uploadFile({ cloudPath: 'races/' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.png', filePath: img.local });
        images.push(up.fileID);
      } else if (img.cloudID) {
        images.push(img.cloudID);
      }
    }
    const data = {
      raceType: f.raceType, raceLevel: f.raceLevel, status: f.status,
      date: f.date, city: f.city.trim(), result: f.status === 'finished' ? f.result : '',
      distance: f.raceType === 'trail' ? f.distance : '', elevation: f.raceType === 'trail' ? f.elevation : '', itra: f.raceType === 'trail' && f.status === 'finished' ? f.itra : '', certs: f.raceType === 'trail' ? f.certs : undefined,
      note: f.note.trim(), isPublic: f.isPublic, images,
    };
    if (this.data.editingId) {
      await db.collection('race_records').doc(this.data.editingId).update({ data });
    } else {
      const u = wx.getStorageSync('userInfo');
      await db.collection('race_records').add({ data: { ...data, userId: u._id, createTime: new Date() } });
    }
    // 检查是否刷新 PB
    if (f.status === 'finished' && f.result) {
      await this.checkPB(f.raceType, f.result);
    }
    wx.hideLoading();
    wx.showToast({ title: '已保存', icon: 'success' });
    this.setData({ showForm: false });
    this.loadRecords();
  },

  // 检查并更新 PB
  async checkPB(type, result) {
    const u = wx.getStorageSync('userInfo');
    if (!u?._id) return;
    const fields = { '10k': 'pb10k', half: 'pbHalf', full: 'pbFull' };
    const field = fields[type];
    if (!field) return;
    const current = u[field];
    const toSec = (t) => { const p = t.split(':'); return +p[0]*3600 + +p[1]*60 + +(p[2]||0); };
    const newSec = toSec(result);
    if (!current || newSec < toSec(current)) {
      await dbUtil.updateUser(u._id, { [field]: result });
      u[field] = result;
      wx.setStorageSync('userInfo', u);
      wx.showToast({ title: '🏆 新PB！', icon: 'success', duration: 2000 });
    }
  },
});
