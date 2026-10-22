// pages/winter/checkin.js - 每日打卡（上传图片 + 跑量/时长）
const w = require('../../utils/winter');

Page({
  data: {
    loading: true, submitting: false,
    date: '', maxDate: '', weekStart: '',
    imageFileID: '', tempImage: '', _localPath: '',
    distance: '', duration: '', note: '',
    kpiType: 'distance', needDistance: true,
    todayRecord: null, statusText: '',
    weekDays: [],
  },

  async onShow() {
    await this.load();
  },

  async load() {
    const today = this.fmt(new Date());
    // 可选范围：本周一 ~ 今天（周一零点起上周锁定，不可跨周补卡）
    const r = await w.api.myCheckins({});
    const my = await w.api.myGroup();
    if (!my.ok) {
      wx.showToast({ title: my.error || '加载失败', icon: 'none' });
      this.setData({ loading: false, notJoined: true });
      return;
    }
    const list = (r.ok ? r.list : []) || [];
    const todayRecord = list.find(x => x.date === today) || null;
    // 已选但还没上传成功的本地图片要保留：
    // openMedia 会触发 onHide/onShow，若这里无条件用服务端数据覆盖，刚选好的照片会被清空
    const pendingLocal = (!this.data.imageFileID && this.data._localPath) ? this.data._localPath : '';
    this.setData({
      loading: false,
      date: today,
      maxDate: today,
      weekStart: this.mondayOf(today),
      kpiType: my.me.kpiType || 'distance',
      needDistance: (my.me.kpiType || 'distance') === 'distance',
      todayRecord,
      statusText: todayRecord ? ({ pending: '审核中', approved: '已通过', rejected: '已驳回' }[todayRecord.status] || '') : '',
      imageFileID: pendingLocal ? '' : (todayRecord ? todayRecord.imageFileID : ''),
      tempImage: pendingLocal || (todayRecord && todayRecord.imageFileID ? await w.toTempUrl(todayRecord.imageFileID) : ''),
      distance: todayRecord && todayRecord.distance ? String(todayRecord.distance) : '',
      duration: todayRecord && todayRecord.duration ? String(todayRecord.duration) : '',
      note: todayRecord ? (todayRecord.note || '') : '',
      weekDays: list,
    });
  },

  fmt(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  // 该日期所在周的周一
  mondayOf(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=周日
    const back = dow === 0 ? 6 : dow - 1;
    return this.fmt(new Date(Date.UTC(y, m - 1, d) - back * 86400000));
  },

  onDateChange(e) { this.setData({ date: e.detail.value }); },

  onChooseImage() {
    wx.chooseMedia({
      count: 1, mediaType: ['image'], sourceType: ['album', 'camera'],
      success: (res) => {
        const f = res.tempFiles && res.tempFiles[0];
        if (!f) return;
        this.setData({ tempImage: f.tempFilePath, _localPath: f.tempFilePath, imageFileID: '' });
      },
    });
  },

  onPreview() {
    const url = this.data.tempImage;
    if (!url) return;
    wx.previewImage({ urls: [url] });
  },

  onInput(e) {
    const f = e.currentTarget.dataset.f;
    this.setData({ [f]: e.detail.value });
  },

  async onSubmit() {
    const d = this.data;
    if (!d.tempImage && !d.imageFileID) return wx.showToast({ title: '请上传跑步记录截图', icon: 'none' });
    if (d.needDistance && !Number(d.distance)) return wx.showToast({ title: '请填写本次跑量', icon: 'none' });
    if (!d.needDistance && !Number(d.duration)) return wx.showToast({ title: '请填写本次时长', icon: 'none' });

    this.setData({ submitting: true });
    wx.showLoading({ title: '提交中' });
    let imageFileID = d.imageFileID;
    try {
      if (!imageFileID && d._localPath) {
        imageFileID = await w.uploadCheckinImage(d._localPath);
        // 回写已上传的 fileID，避免 onShow 再次把这张图当成本地待提交图
        this.setData({ imageFileID });
      }
      const r = await w.api.checkin({
        date: d.date,
        imageFileID,
        distance: Number(d.distance) || 0,
        duration: Number(d.duration) || 0,
        note: d.note,
      });
      wx.hideLoading();
      this.setData({ submitting: false });
      if (!r.ok) return wx.showToast({ title: r.error || '提交失败', icon: 'none' });
      wx.showToast({ title: '已提交，等待队长/教练审核', icon: 'success' });
      setTimeout(() => this.load(), 800);
    } catch (err) {
      wx.hideLoading();
      this.setData({ submitting: false });
      wx.showToast({ title: '上传失败，请重试', icon: 'none' });
    }
  },
});
