// pages/records/index.js - 跑马记录
const dbUtil = require('../../utils/db');
const db = dbUtil.db;
const raceUtil = require('../../utils/raceEvents');

// 成绩合法性：10K≥28分、半马≥1小时、全马≥2小时；越野无下限（>0 即可）
const MIN_RESULT_SEC = { '10k': 1680, half: 3600, full: 7200 };
const isValidTime = (type, t) => {
  const p = (t || '').split(':');
  const sec = (+p[0] || 0) * 3600 + (+p[1] || 0) * 60 + (+p[2] || 0);
  const min = MIN_RESULT_SEC[type] || 0;
  return sec > 0 && sec >= min;
};

Page({
  data: {
    tab: 'full',
    defaultTab: 'full',          // 用户自定义默认 Tab
    showDefaultModal: false,
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
    // 赛事搜索
    searchText: '',
    searchResults: [],
    showSearchResults: false,
    searching: false,
  },

  onLoad() {
    // 读取用户自定义默认 Tab
    const t = wx.getStorageSync('records_default_tab');
    if (['half', 'full', '10k', 'trail'].includes(t)) {
      this.setData({ tab: t, defaultTab: t });
    }
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

  // 默认 Tab 设置
  onShowDefault() { this.setData({ showDefaultModal: true }); },

  onHideDefault() { this.setData({ showDefaultModal: false }); },

  onSetDefault(e) {
    const t = e.currentTarget.dataset.t;
    wx.setStorageSync('records_default_tab', t);
    this.setData({ defaultTab: t, tab: t, showDefaultModal: false });
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
  async onEdit(e) {
    const r = this.data.records.find(x => x._id === e.currentTarget.dataset.id);
    if (!r) return;
    // 转换已有图片为临时链接
    const images = (r.images || []).map(id => ({ cloudID: id, local: '' }));
    const cloudIds = r.images || [];
    if (cloudIds.length) {
      try {
        const res = await wx.cloud.callFunction({ name: 'getImageUrls', data: { fileIDs: cloudIds } });
        const urlMap = {};
        (res.result || []).forEach(f => { if (f.tempFileURL) urlMap[f.fileID] = f.tempFileURL; });
        images.forEach(img => { if (urlMap[img.cloudID]) img.previewUrl = urlMap[img.cloudID]; });
      } catch {}
    }
    this.setData({
      showForm: true, editingId: r._id,
      form: { raceType: r.raceType, raceLevel: r.raceLevel, status: r.status, date: r.date, city: r.city, result: r.result || '', distance: r.distance || '', elevation: r.elevation || '', itra: r.itra || '', certs: r.certs || { itra: false, utmb: false, utmbws: false }, note: r.note || '', isPublic: r.isPublic !== false },
      formImages: images,
      searchText: r.city || '',
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
  onTimeChange(e) {
    const v = e.detail.value;
    if (!isValidTime(this.data.form.raceType, v)) { wx.showToast({ title: '成绩无效（10K≥28分/半马≥1小时/全马≥2小时）', icon: 'none' }); return; }
    this.setData({ 'form.result': v, showTimePicker: false });
  },

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
    const src = e.currentTarget.dataset.src;
    // 表单中预览展示所有已选图片，卡片中预览单张
    if (this.data.showForm && this.data.formImages.length) {
      wx.previewImage({ urls: this.data.formImages.map(f => f.previewUrl || f.local || f.cloudID), current: src });
    } else {
      wx.previewImage({ urls: [src], current: src });
    }
  },

  onHideForm() { this.setData({ showForm: false, searchText: '', searchResults: [], showSearchResults: false }); },
  onHideTime() { this.setData({ showTimePicker: false }); },

  // 赛事搜索
  onSearchRaceInput(e) {
    const text = e.detail.value;
    this.setData({ searchText: text, showSearchResults: !!text });
    if (!text.trim()) { this.setData({ searchResults: [], showSearchResults: false }); return; }
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => this.searchRaces(text.trim()), 300);
  },
  onClearSearch() {
    this.setData({ searchText: '', searchResults: [], showSearchResults: false });
  },
  async searchRaces(text) {
    this.setData({ searching: true });
    try {
      const res = await raceUtil.getAll({ search: text, limit: 10 });
      const list = (res.list || []).map(r => ({
        ...r,
        raceTypesStr: (r.raceTypes || [r.raceType || 'full']).map(t => ({ full: '全马', half: '半马', '10k': '10K', trail: '越野' }[t] || t)).join('/'),
      }));
      this.setData({ searchResults: list, showSearchResults: true });
    } catch (err) {
      console.error('搜索赛事失败:', err);
      this.setData({ searchResults: [] });
    }
    this.setData({ searching: false });
  },
  onSelectRace(e) {
    const race = e.currentTarget.dataset.race;
    if (!race) return;
    const rt = race.raceTypes || [race.raceType || 'full'];
    const primaryType = rt.includes('full') ? 'full' : rt[0];
    const defaults = { '10k': '0:50:30', half: '2:00:00', full: '3:30:00', trail: '5:00:00' };
    this.setData({
      'form.date': this.fmtDate(race.date),
      'form.city': race.name || '',
      'form.raceType': primaryType,
      'form.raceLevel': race.raceLevel || 'B',
      'form.distance': race.distance || '',
      'form.elevation': race.elevation || '',
      'form.certs': race.certs || { itra: false, utmb: false, utmbws: false },
      'form.result': defaults[primaryType] || '3:30:00',
      searchText: race.name || '',
      showSearchResults: false,
    });
  },
  fmtDate(d) {
    if (!d) return '';
    const dt = new Date(d);
    return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
  },

  // 保存
  async onSave() {
    const f = this.data.form;

    if (!f.date) return wx.showToast({ title: '请选日期', icon: 'none' });
    if (f.status === 'finished' && !f.result) return wx.showToast({ title: '请填写成绩', icon: 'none' });
    if (f.status === 'finished' && !isValidTime(f.raceType, f.result)) {
      return wx.showToast({ title: '成绩无效（10K≥28分/半马≥1小时/全马≥2小时）', icon: 'none' });
    }
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
    const newImgUrls = this.data.formImages.map(img => img.previewUrl || img.local || '').filter(Boolean);
    if (this.data.editingId) {
      await db.collection('race_records').doc(this.data.editingId).update({ data });
      // 直接更新本地缓存，避免云数据库 read-after-write 不一致
      const records = this.data.records.slice();
      const idx = records.findIndex(r => r._id === this.data.editingId);
      if (idx > -1) {
        records[idx] = { ...records[idx], ...data, images: data.images, imgUrls: newImgUrls };
        this.setData({ records, showForm: false });
        this.updateFiltered();
        this.updateChart();
      }
    } else {
      const u = wx.getStorageSync('userInfo');
      const addRes = await db.collection('race_records').add({ data: { ...data, userId: u._id, createTime: new Date() } });
      // 新记录加到本地缓存
      const newRecord = { _id: addRes._id, ...data, userId: u._id, createTime: new Date(), imgUrls: newImgUrls };
      const records = [newRecord, ...this.data.records];
      this.setData({ records, showForm: false });
      this.updateFiltered();
      this.updateChart();
    }
    // 检查是否刷新 PB
    if (f.status === 'finished' && f.result) {
      await this.checkPB(f.raceType, f.result);
    }
    wx.hideLoading();
    wx.showToast({ title: '已保存', icon: 'success' });
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
    if (!(newSec > 0)) return; // 无效/0秒成绩不写入 PB
    if (!current || newSec < toSec(current)) {
      await dbUtil.updateUser(u._id, { [field]: result });
      u[field] = result;
      wx.setStorageSync('userInfo', u);
      wx.showToast({ title: '🏆 新PB！', icon: 'success', duration: 2000 });
    }
  },
});
