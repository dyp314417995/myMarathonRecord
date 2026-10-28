// pages/records/certificates.js - 我的证书（荣耀时刻）
// 证书可以关联「我的赛事」里的一场（带出名称/日期/项目/地点），没有的赛事就自己录入
// 支持分享：带 ?userId=xxx 打开可以看别人的证书（只读）
const shareUtil = require('../../utils/share');

const RACE_TYPE_TEXT = { full: '全程马拉松', half: '半程马拉松', '10k': '10 公里', custom: '自定义' };

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

Page({
  data: {
    loading: true,
    userId: '',        // 空 = 看自己的
    mine: true,        // 是否是本人的（别人的只读）
    ownerName: '',
    list: [],

    showForm: false,
    editingId: '',
    form: { eventId: '', name: '', date: '', raceType: 'full', city: '', result: '', rank: '', note: '' },
    formImages: [],    // { local | fileID, previewUrl }
    saving: false,

    showEventPicker: false,
    myEvents: [],      // 我的赛事（可选择的）
    eventsLoading: false,
  },

  async onLoad(options) {
    shareUtil.enableShareMenu();
    const uid = (options && options.userId) || '';
    const u = wx.getStorageSync('userInfo') || {};
    // 分享进来带了 userId 且不是自己 → 看别人的
    if (uid && uid !== (u._id || '')) {
      this.setData({ userId: uid, mine: false });
    }
    await this.load();
  },

  async onShow() {
    // 从别处返回时不重复 loading 闪一下，仅在已有数据时静默刷新
    if (this.data.list.length) await this.load(true);
  },

  onPullDownRefresh() {
    this.load(true).then(() => wx.stopPullDownRefresh());
  },

  // ===== 分享 =====
  onShareAppMessage() {
    const u = wx.getStorageSync('userInfo') || {};
    const n = this.data.list.length;
    const who = this.data.mine ? '我' : (this.data.ownerName || 'TA');
    const title = n ? `${who}的 ${n} 张马拉松证书，荣耀时刻` : `${who}的马拉松证书墙`;
    const id = this.data.userId || u._id || '';
    return shareUtil.buildShare({
      title,
      path: `/pages/records/certificates?userId=${id}`,
      imageUrl: this.data.list[0] && this.data.list[0].imgUrls && this.data.list[0].imgUrls[0] ? this.data.list[0].imgUrls[0] : '',
    });
  },

  onShareTimeline() {
    const n = this.data.list.length;
    const who = this.data.mine ? '我' : (this.data.ownerName || 'TA');
    const id = this.data.userId || (wx.getStorageSync('userInfo') || {})._id || '';
    return shareUtil.buildTimeline({
      title: n ? `${who}的 ${n} 张马拉松证书，荣耀时刻` : `${who}的马拉松证书墙`,
      query: `userId=${id}`,
    });
  },

  async load(silent) {
    if (!silent) this.setData({ loading: true });
    const r = await wx.cloud.callFunction({
      name: 'certs',
      data: { action: 'list', userId: this.data.userId || '' },
    }).then(res => res.result || {}).catch(() => ({ ok: false, msg: '加载失败' }));

    if (!r.ok) {
      this.setData({ loading: false });
      if (!silent) wx.showToast({ title: r.msg || '加载失败', icon: 'none' });
      return;
    }
    const list = await this.fillImages(r.list || []);
    this.setData({
      loading: false,
      list,
      mine: r.mine !== false,
      ownerName: r.ownerName || '',
    });
  },

  // 证书图片是 cloud fileID，批量换临时链接才能显示
  async fillImages(list) {
    const ids = [];
    list.forEach(c => (c.images || []).forEach(id => ids.push(id)));
    const urlMap = {};
    for (let i = 0; i < ids.length; i += 50) {
      try {
        const res = await wx.cloud.callFunction({
          name: 'getImageUrls', data: { fileIDs: ids.slice(i, i + 50) },
        });
        (res.result || []).forEach(f => { if (f && f.tempFileURL) urlMap[f.fileID] = f.tempFileURL; });
      } catch (e) { /* 换链失败就不显示图，不影响列表 */ }
    }
    list.forEach(c => {
      c.imgUrls = (c.images || []).map(id => urlMap[id] || '').filter(Boolean);
      c.raceTypeText = RACE_TYPE_TEXT[c.raceType] || c.raceType || '';
    });
    return list;
  },

  // ===== 添加 / 编辑 =====
  onAdd() {
    this.setData({
      showForm: true, editingId: '',
      form: { eventId: '', name: '', date: todayStr(), raceType: 'full', city: '', result: '', rank: '', note: '' },
      formImages: [],
    });
  },

  onEdit(e) {
    const id = e.currentTarget.dataset.id;
    const c = this.data.list.find(x => x._id === id);
    if (!c) return;
    this.setData({
      showForm: true, editingId: id,
      form: {
        eventId: c.eventId || '', name: c.name || '', date: c.date || '',
        raceType: c.raceType || 'full', city: c.city || '',
        result: c.result || '', rank: c.rank || '', note: c.note || '',
      },
      formImages: (c.images || []).map(id => ({ fileID: id, previewUrl: (c.imgUrls || [])[0] || '' })),
    });
    // 编辑态下预览图要按张对应，这里重新取一遍
    this.fillImages([c]).then(([filled]) => {
      this.setData({
        formImages: (filled.images || []).map((id, i) => ({ fileID: id, previewUrl: (filled.imgUrls || [])[i] || '' })),
      });
    });
  },

  onCloseForm() { this.setData({ showForm: false }); },
  noop() {},

  onInput(e) {
    const f = e.currentTarget.dataset.f;
    this.setData({ [`form.${f}`]: e.detail.value });
  },
  onPickType(e) { this.setData({ 'form.raceType': e.currentTarget.dataset.type }); },
  onDateChange(e) { this.setData({ 'form.date': e.detail.value }); },

  // ===== 从「我的赛事」里选一场，带出赛事信息 =====
  async onOpenEventPicker() {
    this.setData({ showEventPicker: true, eventsLoading: true, myEvents: [] });
    const r = await wx.cloud.callFunction({ name: 'certs', data: { action: 'myEvents' } })
      .then(res => res.result || {}).catch(() => ({ ok: false }));
    this.setData({ eventsLoading: false, myEvents: (r.ok && r.list) ? r.list : [] });
  },
  onCloseEventPicker() { this.setData({ showEventPicker: false }); },

  onPickEvent(e) {
    const id = e.currentTarget.dataset.id;
    const ev = this.data.myEvents.find(x => x._id === id);
    if (!ev) return;
    // 赛事信息 + 成绩一起带出来；没记录过成绩的赛事，成绩留空自己填
    const patch = {
      showEventPicker: false,
      'form.eventId': ev._id,
      'form.name': ev.name || '',
      'form.date': ev.recordDate || ev.date || this.data.form.date,
      'form.city': ev.city || '',
      'form.raceType': ev.raceType || (ev.raceTypes && ev.raceTypes[0]) || this.data.form.raceType,
      'form.result': ev.result || '',
    };
    this.setData(patch);
    if (ev.result) wx.showToast({ title: '已带出成绩 ' + ev.result, icon: 'none' });
  },

  // 选了赛事又想自己改名字时，把关联去掉，避免串味
  onManualName() { this.setData({ 'form.eventId': '' }); },

  // ===== 图片 =====
  onChooseImage() {
    const left = 3 - this.data.formImages.length;
    if (left <= 0) return wx.showToast({ title: '最多 3 张', icon: 'none' });
    wx.chooseMedia({
      count: left, mediaType: ['image'], sourceType: ['album', 'camera'],
      success: (res) => {
        const files = (res.tempFiles || []).map(f => ({ local: f.tempFilePath, previewUrl: f.tempFilePath }));
        this.setData({ formImages: this.data.formImages.concat(files) });
      },
    });
  },
  onRemoveImage(e) {
    const i = Number(e.currentTarget.dataset.i);
    const list = this.data.formImages.slice();
    list.splice(i, 1);
    this.setData({ formImages: list });
  },
  onPreviewImage(e) {
    const { id, url } = e.currentTarget.dataset;
    const c = this.data.list.find(x => x._id === id);
    const urls = (c && c.imgUrls) || [];
    if (urls.length) wx.previewImage({ urls, current: url || urls[0] });
  },
  onPreviewFormImage(e) {
    const i = Number(e.currentTarget.dataset.i) || 0;
    const urls = this.data.formImages.map(x => x.previewUrl).filter(Boolean);
    if (urls.length) wx.previewImage({ urls, current: urls[i] });
  },

  // ===== 保存 =====
  async onSave() {
    const f = this.data.form;
    if (!String(f.name || '').trim()) return wx.showToast({ title: '请填写赛事名称', icon: 'none' });
    if (!this.data.formImages.length) return wx.showToast({ title: '请上传证书图片', icon: 'none' });

    this.setData({ saving: true });
    wx.showLoading({ title: '保存中' });
    const images = [];
    for (const img of this.data.formImages) {
      if (img.fileID) { images.push(img.fileID); continue; }
      if (!img.local) continue;
      try {
        const up = await wx.cloud.uploadFile({
          cloudPath: `certs/${Date.now()}-${Math.random().toString(36).slice(2)}.png`,
          filePath: img.local,
        });
        if (up && up.fileID) images.push(up.fileID);
      } catch (e) { /* 单张失败不阻断 */ }
    }
    const payload = {
      id: this.data.editingId,
      eventId: f.eventId, name: f.name, date: f.date, raceType: f.raceType,
      city: f.city, result: f.result, rank: f.rank, note: f.note, images,
    };
    const r = await wx.cloud.callFunction({
      name: 'certs',
      data: { action: this.data.editingId ? 'update' : 'add', ...payload },
    }).then(res => res.result || {}).catch(() => ({ ok: false, msg: '保存失败' }));

    wx.hideLoading();
    this.setData({ saving: false });
    if (!r.ok) return wx.showToast({ title: r.msg || '保存失败', icon: 'none' });
    wx.showToast({ title: '已保存', icon: 'success' });
    this.setData({ showForm: false });
    await this.load(true);
  },

  // ===== 删除 =====
  onDelete(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除证书',
      content: '删除后不可恢复，确定删除这张证书吗？',
      confirmColor: '#e74c3c',
      success: async (res) => {
        if (!res.confirm) return;
        const r = await wx.cloud.callFunction({ name: 'certs', data: { action: 'remove', id } })
          .then(x => x.result || {}).catch(() => ({ ok: false, msg: '删除失败' }));
        if (!r.ok) return wx.showToast({ title: r.msg || '删除失败', icon: 'none' });
        wx.showToast({ title: '已删除', icon: 'success' });
        this.load(true);
      },
    });
  },
});
