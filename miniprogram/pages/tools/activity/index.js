// pages/tools/activity/index.js
const shareUtil = require('../../../utils/share');

Page({
  data: {
    tab: 'all',
    activities: [],
    myActivities: [],
    lotteries: [],
    myLotteries: [],
    // 分页筛选
    allLoaded: [], page: 1, pageSize: 20, hasMore: false,
    filterIdx: 0, filterOptions: ['全部状态', '报名中', '进行中', '已截止', '已完成', '已取消'],
    // 抽奖分页
    lotPage: 1, lotHasMore: false, allLotteries: [],
  },

  async onShow() {
    shareUtil.enableShareMenu();
    this.setData({ page: 1, allLoaded: [], hasMore: false, lotPage: 1, allLotteries: [] });
    this.loadData();
    this.loadLotteries();
  },

  // 转发（右上角菜单）
  onShareAppMessage() {
    return {
      title: '九州战马跑团活动｜报名、抽奖、组队一起跑',
      path: '/pages/tools/activity/index',
    };
  },

  // ---------- 活动 ----------
  async loadData(isLoadMore = false) {
    if (isLoadMore && !this.data.hasMore) return;
    wx.showLoading({ title: '加载中' });
    const userInfo = wx.getStorageSync('userInfo');
    const userId = userInfo ? (userInfo._id || userInfo.openid) : null;
    const skip = (this.data.page - 1) * this.data.pageSize;

    try {
      const allRes = await wx.cloud.callFunction({ name: 'getActivities', data: { action: 'list', skip, limit: this.data.pageSize } });
      const result = allRes.result || {};
      const allList = result.list || [];
      allList.forEach(item => { item._fmtStart = this.fmtDate(item.timeStart); });
      const merged = isLoadMore ? [...this.data.allLoaded, ...allList] : allList;
      this.setData({ allLoaded: merged, hasMore: result.hasMore || false });
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

  onLotteryDetail(e) {
    wx.navigateTo({ url: `/pages/tools/activity/lottery-detail?id=${e.currentTarget.dataset.id}` });
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

  // ---------- 抽奖 ----------
  async loadLotteries(isLoadMore = false) {
    if (isLoadMore && !this.data.lotHasMore) return;
    try {
      const userInfo = wx.getStorageSync('userInfo');
      const userId = userInfo ? (userInfo._id || userInfo.openid) : null;

      const res = await wx.cloud.callFunction({
        name: 'getLotteries',
        data: { action: 'list', userId, page: this.data.lotPage, pageSize: this.data.pageSize },
      });
      const result = res.result || {};
      const list = result.list || [];
      const merged = isLoadMore ? [...this.data.allLotteries, ...list] : list;
      this.setData({ allLotteries: merged, lotHasMore: result.hasMore || false });

      if (userId) {
        const myRes = await wx.cloud.callFunction({ name: 'getLotteries', data: { action: 'my', userId } });
        this.setData({ myLotteries: (myRes.result || {}).list || [] });
      }
    } catch (e) { console.error(e); }
  },

  onLotLoadMore() {
    if (!this.data.lotHasMore) return;
    this.setData({ lotPage: this.data.lotPage + 1 }, () => this.loadLotteries(true));
  },

  // ---------- 通用 ----------
  fmtDate(d) {
    const dt = new Date(d);
    const m = dt.getMonth() + 1, day = dt.getDate(), h = dt.getHours(), mi = String(dt.getMinutes()).padStart(2, '0');
    return `${m}/${day} ${h}:${mi}`;
  },
});
