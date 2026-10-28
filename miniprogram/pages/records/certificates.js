// pages/records/certificates.js - 我的荣耀时刻
// 数据就是「跑马记录」里已完赛的那些，证书图和名次挂在记录上，不再单独维护一套数据
// 按项目分区：全马 / 半马 / 10 公里 / 其他，每组内按比赛时间倒序（越新越靠上）
// 支持分享：带 ?userId=xxx 打开可以看别人的荣耀墙（只读）
const dbUtil = require('../../utils/db');
const db = dbUtil.db;
const _ = db.command;
const raceUtil = require('../../utils/raceEvents');
const shareUtil = require('../../utils/share');

const MAX_CERT_IMAGES = 3;
// 分区顺序固定，空的不显示
const GROUPS = [
  { key: 'full', label: '全马' },
  { key: 'half', label: '半马' },
  { key: '10k', label: '10 公里' },
  { key: 'custom', label: '其他' },
];

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

Page({
  data: {
    loading: true,
    userId: '',        // 空 = 看自己的
    mine: true,        // 别人的只读
    ownerName: '',
    groups: [],        // [{ key, label, count, list }]
    total: 0,
    stats: [],         // 顶部统计：全马 N 场 / 半马 N 场 ...

    showForm: false,
    editingId: '',
    form: { city: '', date: '', raceType: 'full', result: '', rank: '', note: '' },
    formCertImages: [],
    saving: false,

    showEventPicker: false,
    myEvents: [],
    eventsLoading: false,
  },

  async onLoad(options) {
    shareUtil.enableShareMenu();
    const uid = (options && options.userId) || '';
    const u = wx.getStorageSync('userInfo') || {};
    if (uid && uid !== (u._id || '')) this.setData({ userId: uid, mine: false });
    await this.load();
  },

  async onShow() {
    if (this.data.groups.length) await this.load(true);
  },

  onPullDownRefresh() {
    this.load(true).then(() => wx.stopPullDownRefresh());
  },

  // ===== 分享 =====
  onShareAppMessage() {
    const u = wx.getStorageSync('userInfo') || {};
    const who = this.data.mine ? '我' : (this.data.ownerName || 'TA');
    const title = this.data.total ? `${who}的荣耀时刻：${this.data.total} 场完赛` : `${who}的荣耀时刻`;
    const id = this.data.userId || u._id || '';
    return shareUtil.buildShare({
      title,
      path: `/pages/records/certificates?userId=${id}`,
      imageUrl: this.firstImage() || '',
    });
  },

  onShareTimeline() {
    const u = wx.getStorageSync('userInfo') || {};
    const who = this.data.mine ? '我' : (this.data.ownerName || 'TA');
    const id = this.data.userId || u._id || '';
    return shareUtil.buildTimeline({
      title: this.data.total ? `${who}的荣耀时刻：${this.data.total} 场完赛` : `${who}的荣耀时刻`,
      query: `userId=${id}`,
    });
  },

  firstImage() {
    for (const g of this.data.groups) {
      for (const r of g.list) if (r.showUrls && r.showUrls[0]) return r.showUrls[0];
    }
    return '';
  },

  // ===== 加载 =====
  async load(silent) {
    if (!silent) this.setData({ loading: true });
    const u = wx.getStorageSync('userInfo') || {};
    const userId = this.data.userId || u._id || '';
    if (!userId) { this.setData({ loading: false }); return; }

    try {
      const res = await db.collection('race_records').where({ userId }).orderBy('date', 'desc').limit(200).get();
      // 荣耀墙只放已完赛的（未完赛/弃赛的不算荣誉）
      const finished = (res.data || []).filter(r => r.status === 'finished');
      const list = await this.fillImages(finished);

      const groups = GROUPS.map(g => {
        const l = list.filter(r => (r.raceType || 'custom') === g.key);
        return { key: g.key, label: g.label, count: l.length, list: l };
      }).filter(g => g.count > 0);

      let ownerName = '';
      if (!this.data.mine) {
        const ur = await db.collection('users').where({ _id: userId }).limit(1).get().catch(() => null);
        if (ur && ur.data && ur.data[0]) ownerName = ur.data[0].nickName || ur.data[0].nickname || '';
      }

      this.setData({
        loading: false,
        groups,
        total: list.length,
        stats: groups.map(g => ({ label: g.label, count: g.count })),
        ownerName,
      });
    } catch (e) {
      this.setData({ loading: false });
      if (!silent) wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  // 证书图/成绩截图都是 cloud fileID，批量换临时链接才能显示
  async fillImages(list) {
    const ids = [];
    list.forEach(r => {
      (r.certImages || []).forEach(id => ids.push(id));
      (r.images || []).forEach(id => ids.push(id));
    });
    const urlMap = {};
    for (let i = 0; i < ids.length; i += 50) {
      try {
        const res = await wx.cloud.callFunction({ name: 'getImageUrls', data: { fileIDs: ids.slice(i, i + 50) } });
        (res.result || []).forEach(f => { if (f && f.tempFileURL) urlMap[f.fileID] = f.tempFileURL; });
      } catch (e) { /* 换链失败就不显示图，不影响列表 */ }
    }
    list.forEach(r => {
      r.certUrls = (r.certImages || []).map(id => urlMap[id] || '').filter(Boolean);
      r.imgUrls = (r.images || []).map(id => urlMap[id] || '').filter(Boolean);
      // 优先展示证书图；没传证书的退而用成绩截图，至少不空白
      r.showUrls = r.certUrls.length ? r.certUrls : r.imgUrls;
      r.hasCert = r.certUrls.length > 0;
    });
    return list;
  },

  // ===== 添加 / 编辑（写的是跑马记录，status 固定 finished） =====
  onAdd() {
    this.setData({
      showForm: true, editingId: '',
      form: { city: '', date: todayStr(), raceType: 'full', result: '', rank: '', note: '' },
      formCertImages: [],
    });
  },

  onEdit(e) {
    const id = e.currentTarget.dataset.id;
    let r = null;
    for (const g of this.data.groups) { r = g.list.find(x => x._id === id) || r; }
    if (!r) return;
    this.setData({
      showForm: true, editingId: id,
      form: {
        city: r.city || '', date: r.date || '', raceType: r.raceType || 'full',
        result: r.result || '', rank: r.rank || '', note: r.note || '',
      },
      formCertImages: (r.certImages || []).map((id, i) => ({ cloudID: id, previewUrl: (r.certUrls || [])[i] || '' })),
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

  // ===== 从「我的赛事」里选一场，带出信息 + 已记录的成绩 =====
  async onOpenEventPicker() {
    this.setData({ showEventPicker: true, eventsLoading: true, myEvents: [] });
    try {
      const u = wx.getStorageSync('userInfo') || {};
      const uid = u._id;
      const mkRes = await raceUtil.getMyMarkers(uid);
      const markers = (mkRes && mkRes.data) || [];
      const ids = [...new Set(markers.map(m => m.eventId).filter(Boolean))].slice(0, 100);
      if (!ids.length) { this.setData({ eventsLoading: false, myEvents: [] }); return; }

      const evRes = await db.collection('race_events').where({ _id: _.in(ids) }).limit(100).get().catch(() => null);
      // 本人成绩：① marker.recordId 精确关联 ② 按赛事名兜底（race_records.city 存的是赛事名）
      const recRes = await db.collection('race_records').where({ userId: uid }).limit(200).get().catch(() => null);
      const recs = (recRes && recRes.data) || [];
      const recById = {};
      recs.forEach(r => { recById[r._id] = r; });
      const recByName = {};
      recs.forEach(r => { if (r.city) recByName[r.city] = r; });
      const recIdByEvent = {};
      markers.forEach(m => { if (m.recordId) recIdByEvent[m.eventId] = m.recordId; });

      const list = ((evRes && evRes.data) || []).map(e => {
        const rec = (recIdByEvent[e._id] && recById[recIdByEvent[e._id]]) || recByName[e.name] || null;
        return {
          _id: e._id,
          name: e.name || '',
          date: e.date ? String(e.date).slice(0, 10) : '',
          city: [e.province, e.city].filter(Boolean).join(''),
          raceTypes: Array.isArray(e.raceTypes) ? e.raceTypes : [],
          result: rec ? (rec.result || '') : '',
          raceType: rec ? (rec.raceType || '') : '',
          hasResult: !!(rec && rec.result),
        };
      }).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
      this.setData({ eventsLoading: false, myEvents: list });
    } catch (e) {
      this.setData({ eventsLoading: false, myEvents: [] });
    }
  },
  onCloseEventPicker() { this.setData({ showEventPicker: false }); },

  onPickEvent(e) {
    const id = e.currentTarget.dataset.id;
    const ev = this.data.myEvents.find(x => x._id === id);
    if (!ev) return;
    this.setData({
      showEventPicker: false,
      'form.city': ev.name || '',
      'form.date': ev.date || this.data.form.date,
      'form.raceType': ev.raceType || (ev.raceTypes && ev.raceTypes[0]) || this.data.form.raceType,
      'form.result': ev.result || '',
    });
    if (ev.result) wx.showToast({ title: '已带出成绩 ' + ev.result, icon: 'none' });
  },
  onManualName() { /* 手填赛事名，无需额外处理 */ },

  // ===== 证书图片 =====
  onChooseImage() {
    const left = MAX_CERT_IMAGES - this.data.formCertImages.length;
    if (left <= 0) return wx.showToast({ title: `最多 ${MAX_CERT_IMAGES} 张`, icon: 'none' });
    wx.chooseMedia({
      count: left, mediaType: ['image'], sourceType: ['album', 'camera'],
      success: (res) => {
        const files = (res.tempFiles || []).map(f => ({ local: f.tempFilePath, previewUrl: f.tempFilePath }));
        this.setData({ formCertImages: this.data.formCertImages.concat(files) });
      },
    });
  },
  onRemoveImage(e) {
    const i = Number(e.currentTarget.dataset.i);
    const list = this.data.formCertImages.slice();
    list.splice(i, 1);
    this.setData({ formCertImages: list });
  },
  onPreviewImage(e) {
    const { id, url } = e.currentTarget.dataset;
    let r = null;
    for (const g of this.data.groups) { r = g.list.find(x => x._id === id) || r; }
    const urls = (r && r.showUrls) || [];
    if (urls.length) wx.previewImage({ urls, current: url || urls[0] });
  },
  onPreviewFormImage(e) {
    const i = Number(e.currentTarget.dataset.i) || 0;
    const urls = this.data.formCertImages.map(x => x.previewUrl).filter(Boolean);
    if (urls.length) wx.previewImage({ urls, current: urls[i] });
  },

  // ===== 保存 =====
  async onSave() {
    const f = this.data.form;
    if (!String(f.city || '').trim()) return wx.showToast({ title: '请填写赛事名称', icon: 'none' });
    if (!String(f.result || '').trim()) return wx.showToast({ title: '请填写完赛成绩', icon: 'none' });

    this.setData({ saving: true });
    wx.showLoading({ title: '保存中' });
    try {
      const certImages = [];
      for (const img of this.data.formCertImages) {
        if (img.cloudID) { certImages.push(img.cloudID); continue; }
        if (!img.local) continue;
        const up = await wx.cloud.uploadFile({
          cloudPath: `certs/${Date.now()}-${Math.random().toString(36).slice(2)}.png`,
          filePath: img.local,
        });
        if (up && up.fileID) certImages.push(up.fileID);
      }
      // 荣耀墙上的一条 = 一条已完赛的跑马记录
      const data = {
        raceType: f.raceType, status: 'finished', date: f.date,
        city: String(f.city || '').trim(),
        result: String(f.result || '').trim(),
        rank: String(f.rank || '').trim(),
        note: String(f.note || '').trim(),
        certImages,
        isPublic: true,
      };
      if (this.data.editingId) {
        await db.collection('race_records').doc(this.data.editingId).update({ data });
      } else {
        const u = wx.getStorageSync('userInfo') || {};
        await db.collection('race_records').add({ data: { ...data, userId: u._id, createTime: new Date() } });
      }
      wx.hideLoading();
      this.setData({ saving: false, showForm: false });
      wx.showToast({ title: '已保存', icon: 'success' });
      // 跑马记录页的缓存要失效，免得那边还是旧数据
      await this.load(true);
    } catch (e) {
      wx.hideLoading();
      this.setData({ saving: false });
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  // ===== 删除（删的是整条跑马记录，要提醒清楚） =====
  onDelete(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除这条成绩',
      content: '这是跑马记录里的一条成绩，删掉后成绩和证书都会消失，确定吗？',
      confirmColor: '#e74c3c',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await db.collection('race_records').doc(id).remove();
          wx.showToast({ title: '已删除', icon: 'success' });
          this.load(true);
        } catch (err) {
          wx.showToast({ title: '删除失败', icon: 'none' });
        }
      },
    });
  },

  // 跳到跑马记录页补资料
  onGoRecords() { wx.navigateTo({ url: '/pages/records/index' }); },
});
