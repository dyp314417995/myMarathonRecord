// pages/records/index.js - 跑马记录
const dbUtil = require('../../utils/db');
const cache = require('../../utils/cache');
const db = dbUtil.db;
const raceUtil = require('../../utils/raceEvents');
const shareUtil = require('../../utils/share');

const RECORDS_CACHE_TTL = 5 * 60 * 1000; // 5 分钟

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
    form: { raceType: 'full', raceLevel: 'B', status: 'finished', date: '', city: '', result: '', note: '', isPublic: true, distanceKm: '' },
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
    shareUtil.enableShareMenu();
    // 读取用户自定义默认 Tab
    const t = wx.getStorageSync('records_default_tab');
    if (['half', 'full', '10k', 'custom'].includes(t)) {
      this.setData({ tab: t, defaultTab: t });
    }
  },

  onShow() { this.loadRecords(); },

  // 统计已完赛的全马场次
  countFullMarathons() {
    return (this.data.records || []).filter(r => r.raceType === 'full' && r.status === 'finished').length;
  },

  onShareAppMessage() {
    const u = wx.getStorageSync('userInfo');
    const count = this.countFullMarathons();
    return shareUtil.buildShare({
      title: `我已跑了 ${count} 场马拉松，一起来记录吧`,
      path: `/pages/records/public?userId=${u?._id || ''}&userName=${encodeURIComponent(u?.nickName || '')}`,
    });
  },

  onShareTimeline() {
    const count = this.countFullMarathons();
    return shareUtil.buildTimeline({
      title: `我已跑了 ${count} 场马拉松，一起来记录吧`,
    });
  },

  // 缓存未过期时直接使用本地缓存，不查库；只有查库成功才更新缓存
  async loadRecords(force = false) {
    const u = wx.getStorageSync('userInfo');
    const userId = u?._id;
    if (!userId) return;
    const cacheKey = 'records_' + userId;
    try {
      const { data } = await cache.load(cacheKey, async () => {
        const res = await db.collection('race_records').where({ userId }).orderBy('date', 'desc').get();
        const records = res.data.map(r => ({ ...r, imgUrls: [] }));
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
        records.forEach(r => { r.imgUrls = (r.images || []).map(id => urlMap[id] || '').filter(Boolean); });
        return records;
      }, { ttl: RECORDS_CACHE_TTL, force, versionKey: 'records' });
      // PB 标记成本低，按最新 PB 重算，避免缓存导致 PB 标记不准
      const toSec = (t) => { const p = (t||'').split(':'); return +p[0]*3600 + +p[1]*60 + +(p[2]||0); };
      const pbFields = { '10k': u?.pb10k, half: u?.pbHalf, full: u?.pbFull };
      data.forEach(r => {
        r.isPB = r.status === 'finished' && r.result && toSec(r.result) <= toSec(pbFields[r.raceType]) && r.result === pbFields[r.raceType];
      });
      this.setData({ records: data });
      this.updateFiltered();
      this.updateChart();
    } catch (e) {}
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
      if (tab === 'custom') return r.raceType === 'custom';
      if (tab === '10k') return r.raceType === '10k';
      if (tab === 'half') return r.raceType === 'half';
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
    const defaults = { '10k': '0:50:30', half: '2:00:00', full: '3:30:00' };
    const tab = this.data.tab === 'custom' ? 'custom' : this.data.tab;
    this.setData({
      showForm: true, editingId: '',
      form: { raceType: tab, raceLevel: 'A', status: 'finished', date: '', city: '', result: defaults[tab] || (tab === 'custom' ? '0:30:00' : '3:30:00'), note: '', isPublic: true, distanceKm: '' },
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
      form: { raceType: r.raceType, raceLevel: r.raceLevel, status: r.status, date: r.date, city: r.city, result: r.result || '', note: r.note || '', isPublic: r.isPublic !== false, distanceKm: r.distanceKm || '' },
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
      this.loadRecords(true);
    }});
  },

  // 表单变更
  onFormType(e) {
    const v = e.currentTarget.dataset.v;
    const patch = { 'form.raceType': v };
    if (v === 'custom' && !this.data.form.result) patch['form.result'] = '0:30:00';
    this.setData(patch);
  },
  onFormLevel(e) { this.setData({ 'form.raceLevel': e.currentTarget.dataset.v }); },
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
        raceTypesStr: (r.raceTypes || [r.raceType || 'full']).map(t => ({ full: '全马', half: '半马', '10k': '10K' }[t] || t)).join('/'),
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
    const defaults = { '10k': '0:50:30', half: '2:00:00', full: '3:30:00' };
    this.setData({
      'form.date': this.fmtDate(race.date),
      'form.city': race.name || '',
      'form.raceType': primaryType,
      'form.raceLevel': race.raceLevel || 'B',
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
      note: f.note.trim(), isPublic: f.isPublic, images,
      distanceKm: f.raceType === 'custom' ? String(f.distanceKm || '').trim() : '',
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
      const pbChanged = await this.checkPB(f.raceType, f.result);
      if (pbChanged) { cache.invalidate('members_v2'); cache.invalidate('users_v2'); }
    }
    // 同步本地缓存，避免下次切回来读到旧数据
    const curU = wx.getStorageSync('userInfo');
    if (curU && curU._id) cache.set('records_' + curU._id, this.data.records, RECORDS_CACHE_TTL, 'records');
    wx.hideLoading();
    wx.showToast({ title: '已保存', icon: 'success' });
  },

  // 检查并更新 PB
  async checkPB(type, result) {
    const u = wx.getStorageSync('userInfo');
    if (!u?._id) return false;
    const fields = { '10k': 'pb10k', half: 'pbHalf', full: 'pbFull' };
    const field = fields[type];
    if (!field) return false; // 自定义距离(custom)不参与 PB
    const current = u[field];
    const toSec = (t) => { const p = t.split(':'); return +p[0]*3600 + +p[1]*60 + +(p[2]||0); };
    const newSec = toSec(result);
    if (!current || newSec < toSec(current)) {
      await dbUtil.updateUser(u._id, { [field]: result });
      u[field] = result;
      wx.setStorageSync('userInfo', u);
      wx.showToast({ title: '🏆 新PB！', icon: 'success', duration: 2000 });
      return true;
    }
    return false;
  },
});
