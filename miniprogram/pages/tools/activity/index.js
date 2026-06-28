// pages/tools/activity/index.js
Page({
  data: {
    tab: 'all',
    activities: [],
    myActivities: [],
  },

  async onShow() { this.loadData(); },

  async loadData() {
    wx.showLoading({ title: '加载中' });
    const userInfo = wx.getStorageSync('userInfo');
    const userId = userInfo ? (userInfo._id || userInfo.openid) : null;

    try {
      const allRes = await wx.cloud.callFunction({ name: 'getActivities', data: { action: 'list' } });
      const allList = (allRes.result || {}).list || [];
      allList.forEach(item => { item._fmtStart = this.fmtDate(item.timeStart); });
      this.setData({ activities: allList });
      if (userId) {
        const myRes = await wx.cloud.callFunction({ name: 'getActivities', data: { action: 'my', userId } });
        const myList = (myRes.result || {}).list || [];
        myList.forEach(item => { item._fmtStart = this.fmtDate(item.timeStart); });
        this.setData({ myActivities: myList });
      }
    } catch (e) { console.error(e); }
    wx.hideLoading();
  },

  onTab(e) {
    const tab = e.currentTarget.dataset.t;
    this.setData({ tab });
  },
  onDetail(e) {
    wx.navigateTo({ url: `/pages/tools/activity/detail?id=${e.currentTarget.dataset.id}` });
  },

  fmtDate(d) {
    const dt = new Date(d);
    const m = dt.getMonth() + 1, day = dt.getDate(), h = dt.getHours(), mi = String(dt.getMinutes()).padStart(2, '0');
    return `${m}/${day} ${h}:${mi}`;
  },
});
