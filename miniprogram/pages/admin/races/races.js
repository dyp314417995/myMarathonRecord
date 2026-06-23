// pages/admin/races/races.js - 赛事管理
const raceUtil = require('../../../utils/raceEvents');

Page({
  data: {
    isAdmin: false,
    raceList: [],
    showForm: false,
    editingId: '',
    form: { name: '', date: '', city: '', province: '', raceType: 'full', raceLevel: 'B', distance: '', elevation: '', website: '', scale: '', fee: '', mechanism: '抽签', label: '普通', poster: '' },
    posterTemp: '',  // 临时海报路径
  },

  labels: ['白金', '金标', '精英', '普通'],
  mechanisms: ['抽签', '先到先得'],

  onShow() {
    const userInfo = wx.getStorageSync('userInfo') || {};
    const role = userInfo.role || 'user';
    this.setData({ isAdmin: role === 'super_admin' || role === 'admin' });
    if (this.data.isAdmin) this.loadRaces();
  },

  async loadRaces() {
    const res = await raceUtil.getList();
    this.setData({ raceList: res.data.map(r => ({ ...r, fmtDate: this.fmtDate(r.date) })) });
  },

  fmtDate(d) {
    if (!d) return '';
    const dt = new Date(d);
    return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
  },

  onAdd() {
    this.setData({
      showForm: true, editingId: '', posterTemp: '',
      form: { name: '', date: '', city: '', province: '', raceType: 'full', raceLevel: 'B', distance: '', elevation: '', website: '', scale: '', fee: '', mechanism: '抽签', label: 'A类', poster: '' }
    });
  },

  onEdit(e) {
    const r = this.data.raceList.find(x => x._id === e.currentTarget.dataset.id);
    if (!r) return;
    this.setData({
      showForm: true, editingId: r._id, posterTemp: r.posterUrl || '',
      form: { name: r.name, date: this.fmtDate(r.date), city: r.city||'', province: r.province||'', raceType: r.raceType||'full', raceLevel: r.raceLevel||'B', distance: r.distance||'', elevation: r.elevation||'', website: r.website||'', scale: r.scale||'', fee: r.fee||'', mechanism: r.mechanism||'抽签', label: r.label||'普通', poster: r.poster||'' }
    });
  },

  onDel(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({ title: '删除赛事', content: '确定删除？', confirmColor: '#ff4d4f', success: async (res) => {
      if (!res.confirm) return;
      await raceUtil.remove(id);
      wx.showToast({ title: '已删除', icon: 'success' });
      this.loadRaces();
    }});
  },

  onInput(e) { this.setData({ [`form.${e.currentTarget.dataset.k}`]: e.detail.value }); },
  onFormType(e) { this.setData({ 'form.raceType': e.currentTarget.dataset.v }); },
  onFormLevel(e) { this.setData({ 'form.raceLevel': e.currentTarget.dataset.v }); },
  onFormMechanism(e) { this.setData({ 'form.mechanism': e.currentTarget.dataset.v }); },
  onFormLabel(e) { this.setData({ 'form.label': e.currentTarget.dataset.v }); },
  onDateChange(e) { this.setData({ 'form.date': e.detail.value }); },
  onHideForm() { this.setData({ showForm: false }); },

  onChoosePoster() {
    wx.chooseMedia({
      count: 1, mediaType: ['image'], sourceType: ['album', 'camera'],
      success: (res) => {
        this.setData({ posterTemp: res.tempFiles[0].tempFilePath });
      },
    });
  },

  async onSave() {
    const f = this.data.form;
    if (!f.name.trim()) return wx.showToast({ title: '请输入赛事名称', icon: 'none' });
    if (!f.date) return wx.showToast({ title: '请选择日期', icon: 'none' });
    wx.showLoading({ title: '保存中' });

    // 上传海报
    let poster = f.poster || '';
    if (this.data.posterTemp && this.data.posterTemp !== poster) {
      try {
        const up = await wx.cloud.uploadFile({
          cloudPath: `races/poster-${Date.now()}.png`,
          filePath: this.data.posterTemp,
        });
        poster = up.fileID;
      } catch {}
    }

    const data = {
      name: f.name.trim(), date: new Date(f.date), city: f.city.trim(), province: f.province.trim(),
      raceType: f.raceType, raceLevel: f.raceLevel,
      distance: f.raceType === 'trail' ? f.distance : '', elevation: f.raceType === 'trail' ? f.elevation : '',
      website: f.website.trim(),
      scale: f.scale.trim(), fee: f.fee.trim(), mechanism: f.mechanism, label: f.label,
      poster,
      status: new Date(f.date) < new Date() ? 'finished' : 'upcoming',
      certs: {}, tags: [], tagStats: {}, reviewCount: 0, avgScore: 0,
    };
    if (this.data.editingId) {
      await raceUtil.update(this.data.editingId, data);
    } else {
      await raceUtil.create(data);
    }
    wx.hideLoading();
    wx.showToast({ title: '已保存', icon: 'success' });
    this.setData({ showForm: false });
    this.loadRaces();
  },
});
