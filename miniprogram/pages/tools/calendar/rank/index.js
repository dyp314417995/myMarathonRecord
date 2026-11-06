// pages/tools/calendar/rank/index.js - 线上赛成绩榜（只列审核通过的，按组别升序）
Page({
  data: {
    loading: true, eventId: '', eventName: '',
    groups: [], groupCounts: {}, curGroup: 'all',
    list: [], shown: [],
  },

  onLoad(options) {
    this.setData({
      eventId: options.eventId || '',
      eventName: decodeURIComponent(options.name || ''),
    });
    this.load();
  },

  async load() {
    const r = await wx.cloud.callFunction({
      name: 'raceEvent',
      data: { action: 'onlineRank', eventId: this.data.eventId },
    }).catch(() => null);
    const res = (r && r.result) || {};
    if (!res.ok) {
      wx.showToast({ title: res.error || '加载失败', icon: 'none' });
      this.setData({ loading: false });
      return;
    }
    const counts = {};
    (res.list || []).forEach(x => { counts[x.group] = (counts[x.group] || 0) + 1; });
    this.setData({ loading: false, groups: res.groups || [], groupCounts: counts, list: res.list || [] }, () => this.applyFilter());
  },

  onPickGroup(e) {
    this.setData({ curGroup: e.currentTarget.dataset.g || 'all' }, () => this.applyFilter());
  },

  applyFilter() {
    const g = this.data.curGroup;
    const shown = g === 'all' ? this.data.list : this.data.list.filter(x => x.group === g);
    this.setData({ shown });
  },
});
