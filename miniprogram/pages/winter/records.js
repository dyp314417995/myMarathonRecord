// pages/winter/records.js - 组内打卡记录（本组成员互相可见）
const w = require('../../utils/winter');

Page({
  data: {
    loading: true, list: [], viewList: [], myRole: '',
    weekIndex: 0, weekText: '', filter: 'all',
  },

  onShow() {
    this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  async load() {
    const r = await w.api.groupCheckins({});
    if (!r.ok) {
      wx.showToast({ title: r.error || '加载失败', icon: 'none' });
      this.setData({ loading: false });
      return;
    }
    const list = await w.resolveAvatars(r.list || []);
    // 打卡截图批量转临时链接（image 组件不支持 cloud://）
    const ids = list.map(c => c.imageFileID).filter(Boolean);
    const map = {};
    if (ids.length) {
      try {
        const res = await wx.cloud.callFunction({ name: 'getImageUrls', data: { fileIDs: ids } });
        (res.result || []).forEach(f => { if (f.tempFileURL) map[f.fileID] = f.tempFileURL; });
      } catch (e) { /* ignore */ }
    }
    list.forEach(c => { c.tempImage = map[c.imageFileID] || ''; });

    this.setData({
      loading: false,
      list,
      myRole: r.myRole || '',
      weekIndex: r.weekIndex,
      weekText: r.weekIndex > 0 ? ('第 ' + r.weekIndex + ' 周') : '试运行',
    });
    this.applyFilter();
  },

  onFilter(e) {
    this.setData({ filter: e.currentTarget.dataset.v });
    this.applyFilter();
  },

  applyFilter() {
    const all = this.data.list || [];
    const viewList = this.data.filter === 'mine' ? all.filter(c => c.isMe) : all;
    this.setData({ viewList });
  },

  onPreview(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) return;
    const urls = (this.data.viewList || []).map(c => c.tempImage).filter(Boolean);
    wx.previewImage({ urls: urls.length ? urls : [url], current: url });
  },

  // 头像加载失败：置空，改用文字头像兜底
  onAvatarError(e) {
    const i = Number(e.currentTarget.dataset.i);
    if (this.data.viewList[i]) this.setData({ [`viewList[${i}].avatarUrl`]: '' });
  },
});
