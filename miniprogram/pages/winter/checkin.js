// pages/winter/checkin.js - 每日打卡（支持一天多次，每次最多 3 张图）
const w = require('../../utils/winter');

const MAX_IMAGES = 3;

Page({
  data: {
    loading: true, submitting: false,
    date: '', maxDate: '', weekStart: '',
    // 本次要提交的图片：本地待上传的临时路径 + 已上传的 fileID（两者加起来算总数）
    localImages: [], uploadedFileIDs: [],
    distance: '', duration: '', note: '',
    kpiType: 'distance', needDistance: true,
    todayList: [], todayCount: 0,   // 今天已打过的卡（一天可以多次）
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
    // 一天可多次：这里展示当天已有的打卡，表单本身每次都是新的一次，不再回填
    const todayList = list.filter(x => x.date === today);
    this.setData({
      loading: false,
      date: today,
      maxDate: today,
      weekStart: this.mondayOf(today),
      kpiType: my.me.kpiType || 'distance',
      needDistance: (my.me.kpiType || 'distance') === 'distance',
      todayList, todayCount: todayList.length,
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

  // 一次打卡最多 3 张图；选图时按剩余额度限制
  onChooseImage() {
    const left = MAX_IMAGES - (this.data.localImages.length + this.data.uploadedFileIDs.length);
    if (left <= 0) return wx.showToast({ title: `最多 ${MAX_IMAGES} 张`, icon: 'none' });
    wx.chooseMedia({
      count: left, mediaType: ['image'], sourceType: ['album', 'camera'],
      success: (res) => {
        const files = (res.tempFiles || []).map(f => f.tempFilePath).filter(Boolean);
        if (!files.length) return;
        const merged = this.data.localImages.concat(files).slice(0, MAX_IMAGES - this.data.uploadedFileIDs.length);
        this.setData({ localImages: merged });
      },
    });
  },

  onRemoveImage(e) {
    const i = Number(e.currentTarget.dataset.i);
    const list = this.data.localImages.slice();
    if (i >= 0 && i < list.length) {
      list.splice(i, 1);
      this.setData({ localImages: list });
    }
  },

  onPreview(e) {
    const i = Number(e.currentTarget.dataset.i) || 0;
    const urls = this.data.localImages.length ? this.data.localImages : [];
    if (!urls.length) return;
    wx.previewImage({ urls, current: urls[i] });
  },

  onInput(e) {
    const f = e.currentTarget.dataset.f;
    this.setData({ [f]: e.detail.value });
  },

  async onSubmit() {
    const d = this.data;
    const total = d.localImages.length + d.uploadedFileIDs.length;
    if (!total) return wx.showToast({ title: '请上传跑步记录截图', icon: 'none' });
    if (d.needDistance && !Number(d.distance)) return wx.showToast({ title: '请填写本次跑量', icon: 'none' });
    if (!d.needDistance && !Number(d.duration)) return wx.showToast({ title: '请填写本次时长', icon: 'none' });

    this.setData({ submitting: true });
    wx.showLoading({ title: '提交中' });
    try {
      // 本地图逐个上传，拿到 fileID 再一起提交
      const ids = d.uploadedFileIDs.slice();
      for (const p of d.localImages) {
        const fileID = await w.uploadCheckinImage(p);
        if (fileID) ids.push(fileID);
      }
      const r = await w.api.checkin({
        date: d.date,
        imageFileIDs: ids,
        distance: Number(d.distance) || 0,
        duration: Number(d.duration) || 0,
        note: d.note,
      });
      wx.hideLoading();
      this.setData({
        submitting: false,
        localImages: [], uploadedFileIDs: [],
        distance: '', duration: '', note: '',
      });
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
