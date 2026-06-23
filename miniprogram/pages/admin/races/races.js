// pages/admin/races/races.js - 赛事管理
const raceUtil = require('../../../utils/raceEvents');

Page({
  data: {
    isAdmin: false,
    raceList: [],
    showForm: false,
    editingId: '',
    form: { name: '', date: '', city: '', province: '', raceType: 'full', raceLevel: 'B', distance: '', elevation: '', website: '' },
  },

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
      showForm: true, editingId: '',
      form: { name: '', date: '', city: '', province: '', raceType: 'full', raceLevel: 'B', distance: '', elevation: '', website: '' }
    });
  },

  onEdit(e) {
    const r = this.data.raceList.find(x => x._id === e.currentTarget.dataset.id);
    if (!r) return;
    this.setData({
      showForm: true, editingId: r._id,
      form: { name: r.name, date: this.fmtDate(r.date), city: r.city||'', province: r.province||'', raceType: r.raceType||'full', raceLevel: r.raceLevel||'B', distance: r.distance||'', elevation: r.elevation||'', website: r.website||'' }
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
  onDateChange(e) { this.setData({ 'form.date': e.detail.value }); },
  onHideForm() { this.setData({ showForm: false }); },

  async onSave() {
    const f = this.data.form;
    if (!f.name.trim()) return wx.showToast({ title: '请输入赛事名称', icon: 'none' });
    if (!f.date) return wx.showToast({ title: '请选择日期', icon: 'none' });
    wx.showLoading({ title: '保存中' });
    const data = {
      name: f.name.trim(), date: new Date(f.date), city: f.city.trim(), province: f.province.trim(),
      raceType: f.raceType, raceLevel: f.raceLevel,
      distance: f.raceType === 'trail' ? f.distance : '', elevation: f.raceType === 'trail' ? f.elevation : '',
      website: f.website.trim(),
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
