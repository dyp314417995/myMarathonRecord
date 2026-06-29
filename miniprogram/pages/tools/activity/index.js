// pages/tools/activity/index.js
Page({
  data: {
    tab: 'all',
    activities: [],
    myActivities: [],
    // 分页筛选
    allLoaded: [], page: 1, pageSize: 20, hasMore: false,
    filterIdx: 0, filterOptions: ['全部状态', '报名中', '进行中', '已截止', '已完成', '已取消'],
  },

  async onShow() { this.loadData(); },

  async loadData() {
    wx.showLoading({ title: '加载中' });
    const userInfo = wx.getStorageSync('userInfo');
    const userId = userInfo ? (userInfo._id || userInfo.openid) : null;

    try {
      const allRes = await wx.cloud.callFunction({ name: 'getActivities', data: { action: 'list', limit: 100 } });
      const allList = (allRes.result || {}).list || [];
      allList.forEach(item => { item._fmtStart = this.fmtDate(item.timeStart); });
      this.setData({ allLoaded: allList, page: 1 });
      this.applyFilter();
      if (userId) {
        const myRes = await wx.cloud.callFunction({ name: 'getActivities', data: { action: 'my', userId } });
        const myList = (myRes.result || {}).list || [];
        myList.forEach(item => { item._fmtStart = this.fmtDate(item.timeStart); });
        this.setData({ myActivities: myList });
      }
    } catch (e) { console.error(e); }
    wx.hideLoading();
  },

  applyFilter() {
    const { allLoaded, filterIdx, filterOptions } = this.data;
    const thisYear = new Date().getFullYear();
    let list = allLoaded.filter(a => {
      const ts = a.timeStart ? new Date(a.timeStart) : null;
      return ts && ts.getFullYear() === thisYear;
    });
    if (filterIdx > 0) {
      const tag = filterOptions[filterIdx];
      list = list.filter(a => a.stateTag && a.stateTag.text === tag);
    }
    // 按最近时间节点排序（截止/开始时间取最近）
    const now = new Date();
    list.sort((a, b) => {
      const na = Math.min(
        a.deadline && new Date(a.deadline) > now ? new Date(a.deadline) : Infinity,
        new Date(a.timeStart) > now ? new Date(a.timeStart) : Infinity
      );
      const nb = Math.min(
        b.deadline && new Date(b.deadline) > now ? new Date(b.deadline) : Infinity,
        new Date(b.timeStart) > now ? new Date(b.timeStart) : Infinity
      );
      return na - nb;
    });
    const end = this.data.page * this.data.pageSize;
    const sliced = list.slice(0, end);
    this.setData({ activities: sliced, hasMore: end < list.length });
  },

  onLoadMore() {
    this.setData({ page: this.data.page + 1 });
    this.applyFilter();
  },

  onFilter(e) {
    this.setData({ filterIdx: e.currentTarget.dataset.idx, page: 1 });
    this.applyFilter();
  },

  onTab(e) {
    const tab = e.currentTarget.dataset.t;
    this.setData({ tab });
  },
  onDetail(e) {
    wx.navigateTo({ url: `/pages/tools/activity/detail?id=${e.currentTarget.dataset.id}` });
  },
  async onUnregister(e) {
    const id = e.currentTarget.dataset.id;
    const userInfo = wx.getStorageSync('userInfo');
    wx.showModal({
      title: '取消报名', content: '确定取消？',
      success: async (res) => {
        if (!res.confirm) return;
        await wx.cloud.callFunction({ name: 'getActivities', data: { action: 'unregister', activityId: id, userId: userInfo._id } });
        wx.showToast({ title: '已取消', icon: 'success' });
        this.loadData();
      },
    });
  },

  fmtDate(d) {
    const dt = new Date(d);
    const m = dt.getMonth() + 1, day = dt.getDate(), h = dt.getHours(), mi = String(dt.getMinutes()).padStart(2, '0');
    return `${m}/${day} ${h}:${mi}`;
  },
});
