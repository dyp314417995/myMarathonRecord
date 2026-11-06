// pages/tools/calendar/submit-result/index.js - 线上赛提交成绩
const raceUtil = require('../../../../utils/raceEvents');

Page({
  data: {
    loading: true, eventId: '',
    event: null, groups: [], groupKm: {},
    runWindow: null, resultDeadline: '', proofRequired: true,
    today: '',
    // 表单
    form: { runDate: '', groupIdx: 0, distanceKm: '', result: '', note: '' },
    images: [],
    submitting: false,
    paceText: '',
    // 我的最近提交
    mySubmit: null,
  },

  async onLoad(options) {
    const eventId = options.eventId || '';
    this.setData({ eventId, today: this.fmtDate(new Date()) });
    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo || !userInfo._id) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    try {
      const { event } = await raceUtil.getEventDetail(eventId, userInfo._id);
      if (!event) return wx.showToast({ title: '赛事不存在', icon: 'none' });
      const win = event.runWindow || {};
      this.setData({
        loading: false,
        event: { name: event.name, mode: event.mode },
        groups: event.groups || [],
        groupKm: event.groupKm || {},
        runWindow: win.start ? win : null,
        resultDeadline: event.resultDeadline || '',
        proofRequired: event.proofRequired !== false,
        'form.runDate': this.today,
      });
      this.loadMySubmit();
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  fmtDate(d) {
    const dt = d instanceof Date ? d : new Date(d);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  },

  async loadMySubmit() {
    const userInfo = wx.getStorageSync('userInfo');
    const r = await wx.cloud.callFunction({
      name: 'raceEvent',
      data: { action: 'myResults', userId: userInfo._id, eventId: this.data.eventId },
    }).catch(() => null);
    const res = (r && r.result) || {};
    if (res.ok && res.list && res.list.length) {
      const s = res.list[0];
      this.setData({
        mySubmit: s,
        // 被驳回重提：把上次的内容带回来改
        form: s.status === 'rejected' ? {
          runDate: s.runDate || this.data.today,
          groupIdx: Math.max(0, this.data.groups.indexOf(s.group)),
          distanceKm: s.distanceKm ? String(s.distanceKm) : '',
          result: s.result || '',
          note: '',
        } : this.data.form,
        images: [],
      });
    }
  },

  onPickDate(e) { this.setData({ 'form.runDate': e.detail.value }); },
  onPickGroup(e) { this.setData({ 'form.groupIdx': Number(e.detail.value) || 0 }); },
  onInputDistance(e) { this.setData({ 'form.distanceKm': e.detail.value }, () => this.calcPace()); },
  onInputResult(e) { this.setData({ 'form.result': e.detail.value }, () => this.calcPace()); },
  onInputNote(e) { this.setData({ 'form.note': e.detail.value }); },

  calcPace() {
    const { distanceKm, result } = this.data.form;
    const km = Number(distanceKm);
    const m = String(result || '').trim().match(/^(\d{1,2}):([0-5]?\d):([0-5]?\d)$/);
    if (!(km > 0) || !m) return this.setData({ paceText: '' });
    const sec = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
    const pace = sec / km;
    this.setData({ paceText: `配速 ${Math.floor(pace / 60)}'${String(Math.round(pace % 60)).padStart(2, '0')}/km` });
  },

  onChooseImage() {
    const remain = 3 - this.data.images.length;
    if (remain <= 0) return;
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: async (res) => {
        wx.showLoading({ title: '上传中' });
        const added = [];
        try {
          for (const f of res.tempFiles) {
            const up = await wx.cloud.uploadFile({
              cloudPath: `race-proof/${this.data.eventId}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`,
              filePath: f.tempFilePath,
            });
            added.push(up.fileID);
          }
          this.setData({ images: [...this.data.images, ...added] });
        } catch (e) {
          wx.showToast({ title: '上传失败，请重试', icon: 'none' });
        }
        wx.hideLoading();
      },
    });
  },
  onRemoveImage(e) {
    const i = Number(e.currentTarget.dataset.idx);
    const images = this.data.images.slice();
    images.splice(i, 1);
    this.setData({ images });
  },
  onPreviewImage(e) {
    const i = Number(e.currentTarget.dataset.idx);
    // cloud:// 预览需要临时链接；这里仅本地展示用 fileID 直接预览在部分机型不可行，
    // 故上传后立即换临时链接成本高，v1 先用 chooseMedia 的本地路径预览：重选后直接提交
    wx.previewImage({ urls: this.data.images, current: this.data.images[i] });
  },

  async onSubmit() {
    if (this.data.submitting) return;
    const { eventId, form, images } = this.data;
    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo || !userInfo._id) return wx.navigateTo({ url: '/pages/login/login' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.runDate)) return wx.showToast({ title: '请选择跑步日期', icon: 'none' });
    const km = Number(form.distanceKm);
    if (!(km > 0)) return wx.showToast({ title: '请填写跑步距离', icon: 'none' });
    if (!/^\d{1,2}:\d{2}:\d{2}$/.test(form.result.trim())) return wx.showToast({ title: '成绩格式：时:分:秒，如 0:52:30', icon: 'none' });
    if (this.data.proofRequired && images.length === 0) return wx.showToast({ title: '请上传跑步截图', icon: 'none' });

    this.setData({ submitting: true });
    wx.showLoading({ title: '提交中' });
    const r = await wx.cloud.callFunction({
      name: 'raceEvent',
      data: {
        action: 'submitResult', userId: userInfo._id, eventId,
        runDate: form.runDate,
        group: this.data.groups[form.groupIdx] || '',
        distanceKm: km,
        result: form.result.trim(),
        proofImages: images,
        note: form.note,
      },
    }).catch(e => ({ result: { ok: false, error: e.message } }));
    wx.hideLoading();
    this.setData({ submitting: false });
    const res = (r && r.result) || {};
    if (!res.ok) return wx.showToast({ title: res.error || '提交失败', icon: 'none', duration: 2500 });
    wx.showToast({ title: res.flags && res.flags.includes('reuse') ? '已提交（截图疑似复用，将重点人工核对）' : '已提交，待管理员审核', icon: 'none', duration: 2500 });
    this.loadMySubmit();
  },
});
