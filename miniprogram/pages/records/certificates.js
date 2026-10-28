// pages/records/certificates.js - 我的荣耀时刻（纯展示页）
// 数据就是「跑马记录」里已完赛且传了证书的那些，证书图和名次挂在记录上，不再单独维护一套数据
// 没传证书的记录不进这里；添加 / 编辑 / 删除一律回「跑马记录」操作，这里不提供
// 按项目分区：全马 / 半马 / 10 公里 / 其他，每组内按比赛时间倒序；顶部统计可点击切换
// 支持分享：带 ?userId=xxx 打开可以看别人的荣耀墙（只读）
const dbUtil = require('../../utils/db');
const db = dbUtil.db;
const shareUtil = require('../../utils/share');

// 分区顺序固定，空的不显示
const GROUPS = [
  { key: 'full', label: '全马' },
  { key: 'half', label: '半马' },
  { key: '10k', label: '10 公里' },
  { key: 'custom', label: '其他' },
];

Page({
  data: {
    loading: true,
    userId: '',        // 空 = 看自己的
    mine: true,        // 别人的只读
    ownerName: '',
    groups: [],        // 当前显示的分组（受统计条切换影响）
    allGroups: [],     // 全部分组（不受切换影响，切换时不用重新查库）
    activeType: '',    // 统计条选中的项目，空 = 全部
    total: 0,
    stats: [],         // 顶部统计：全马 N 场 / 半马 N 场 ...
  },

  async onLoad(options) {
    shareUtil.enableShareMenu();
    const uid = (options && options.userId) || '';
    const u = wx.getStorageSync('userInfo') || {};
    if (uid && uid !== (u._id || '')) this.setData({ userId: uid, mine: false });
    await this.load();
  },

  async onShow() {
    if (this.data.allGroups.length) await this.load(true);
  },

  onPullDownRefresh() {
    this.load(true).then(() => wx.stopPullDownRefresh());
  },

  // ===== 分享 =====
  onShareAppMessage() {
    const u = wx.getStorageSync('userInfo') || {};
    const who = this.data.mine ? '我' : (this.data.ownerName || 'TA');
    const id = this.data.userId || u._id || '';
    return shareUtil.buildShare({
      title: this.shareTitle(who),
      path: `/pages/records/certificates?userId=${id}`,
      imageUrl: this.firstImage() || '',
    });
  },

  onShareTimeline() {
    const u = wx.getStorageSync('userInfo') || {};
    const who = this.data.mine ? '我' : (this.data.ownerName || 'TA');
    const id = this.data.userId || u._id || '';
    return shareUtil.buildTimeline({
      title: this.shareTitle(who),
      query: `userId=${id}`,
    });
  },

  shareTitle(who) {
    return this.data.total ? `${who}的荣耀时刻：${this.data.total} 场完赛` : `${who}的荣耀时刻`;
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
      // 荣耀墙只放「已完赛且传了证书图」的：没证书的跑马记录不进这里
      const honored = (res.data || []).filter(r => r.status === 'finished' && (r.certImages || []).length > 0);
      const list = await this.fillImages(honored);

      const allGroups = GROUPS.map(g => {
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
        allGroups,
        total: list.length,
        stats: allGroups.map(g => ({ key: g.key, label: g.label, count: g.count })),
        ownerName,
      });
      this.applyFilter();
    } catch (e) {
      this.setData({ loading: false });
      if (!silent) wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  // 证书图是 cloud fileID，批量换临时链接才能显示
  async fillImages(list) {
    const ids = [];
    list.forEach(r => (r.certImages || []).forEach(id => ids.push(id)));
    const urlMap = {};
    for (let i = 0; i < ids.length; i += 50) {
      try {
        const res = await wx.cloud.callFunction({ name: 'getImageUrls', data: { fileIDs: ids.slice(i, i + 50) } });
        (res.result || []).forEach(f => { if (f && f.tempFileURL) urlMap[f.fileID] = f.tempFileURL; });
      } catch (e) { /* 换链失败就不显示图，不影响列表 */ }
    }
    list.forEach(r => {
      r.certUrls = (r.certImages || []).map(id => urlMap[id] || '').filter(Boolean);
      r.showUrls = r.certUrls;
    });
    return list;
  },

  // 统计条切换：点一下只看这个项目，再点一下回到全部（纯本地过滤，不重新查库）
  onPickStat(e) {
    const key = e.currentTarget.dataset.key || '';
    this.setData({ activeType: this.data.activeType === key ? '' : key });
    this.applyFilter();
  },

  applyFilter() {
    const active = this.data.activeType;
    const groups = active ? this.data.allGroups.filter(g => g.key === active) : this.data.allGroups;
    this.setData({ groups });
  },

  // 添加 / 编辑 / 删除都回跑马记录做
  onGoRecords() {
    wx.navigateTo({ url: '/pages/records/index?add=1' });
  },

  onPreviewImage(e) {
    const { id, url } = e.currentTarget.dataset;
    let r = null;
    for (const g of this.data.groups) { r = g.list.find(x => x._id === id) || r; }
    const urls = (r && r.showUrls) || [];
    if (urls.length) wx.previewImage({ urls, current: url || urls[0] });
  },
});
