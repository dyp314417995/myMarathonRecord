// pages/admin/raceReview/raceReview.js - 线上赛成绩审核（管理员）
// 人工审核要点（设计文档 10.2）：截图关键信息 / 跑步机 / GPS 轨迹 / 拼接痕迹 / 与本人历史比 / 同日多场
Page({
  data: {
    loading: true, eventId: '',
    list: [],
    processingId: '',
  },

  onLoad(options) {
    this.setData({ eventId: options.eventId || '' });
  },

  async onShow() {
    await this.load();
  },

  async load() {
    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo || !userInfo._id) return wx.navigateTo({ url: '/pages/login/login' });
    const r = await wx.cloud.callFunction({
      name: 'raceEvent',
      data: { action: 'pendingResults', userId: userInfo._id, eventId: this.data.eventId },
    }).catch(() => null);
    const res = (r && r.result) || {};
    if (!res.ok) {
      wx.showToast({ title: res.error || '加载失败', icon: 'none' });
      this.setData({ loading: false });
      return;
    }
    this.setData({ loading: false, list: res.list || [] });
  },

  onPreview(e) {
    const { urls, cur } = e.currentTarget.dataset;
    wx.previewImage({ urls, current: cur });
  },

  onApprove(e) {
    const id = e.currentTarget.dataset.id;
    const userInfo = wx.getStorageSync('userInfo');
    wx.showModal({ title: '通过', content: '确认该成绩真实有效？通过后写入跑马记录并进成绩榜。', success: async (res) => {
      if (!res.confirm) return;
      wx.showLoading({ title: '处理中' });
      const r = await wx.cloud.callFunction({
        name: 'raceEvent',
        data: { action: 'reviewResult', userId: userInfo._id, submitId: id, pass: true, note: '' },
      }).catch(() => ({ result: { ok: false } }));
      wx.hideLoading();
      const out = (r && r.result) || {};
      if (!out.ok) return wx.showToast({ title: out.error || '操作失败', icon: 'none' });
      wx.showToast({ title: '已通过', icon: 'success' });
      this.load();
    }});
  },

  onReject(e) {
    const id = e.currentTarget.dataset.id;
    const userInfo = wx.getStorageSync('userInfo');
    wx.showModal({
      title: '驳回',
      editable: true,
      placeholderText: '必须写明理由，如：截图无日期 / 配速异常',
      success: async (res) => {
        if (!res.confirm) return;
        const note = (res.content || '').trim();
        if (!note) return wx.showToast({ title: '驳回必须写明理由', icon: 'none' });
        wx.showLoading({ title: '处理中' });
        const r = await wx.cloud.callFunction({
          name: 'raceEvent',
          data: { action: 'reviewResult', userId: userInfo._id, submitId: id, pass: false, note },
        }).catch(() => ({ result: { ok: false } }));
        wx.hideLoading();
        const out = (r && r.result) || {};
        if (!out.ok) return wx.showToast({ title: out.error || '操作失败', icon: 'none' });
        wx.showToast({ title: '已驳回', icon: 'success' });
        this.load();
      },
    });
  },
});
