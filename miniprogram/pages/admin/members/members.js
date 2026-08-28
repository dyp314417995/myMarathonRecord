// pages/admin/members/members.js - 跑友名录
const dbUtil = require('../../../utils/db');

// 时间字符串转秒：非法（如 0000）/空/0秒 返回 -1，视为无成绩
const toSec = (t) => {
  if (typeof t !== 'string') return -1;
  const p = t.split(':');
  if (p.length !== 3) return -1;
  const h = +p[0], m = +p[1], s = +p[2];
  if (!isFinite(h) || !isFinite(m) || !isFinite(s) || m > 59 || s > 59) return -1;
  const sec = h * 3600 + m * 60 + s;
  return sec > 0 ? sec : -1;
};
const fmtPB = (t) => (toSec(t) > 0 ? t : '');

Page({
  data: {
    allUsers: [], users: [], loading: true,
    searchKey: '', sortBy: 'time', sortAsc: false,
    totalCount: 0,
    showDetail: false, detailUser: {}, detailGroups: '', detailRaces: [],
    page: 1,
    pageSize: 20,
    hasMore: false,
  },

  async onShow() { this.loadUsers(); },

  // 组装展示字段（头像临时链接/群名/清洗后的成绩）
  decorateUser(u, urlMap, groupMap) {
    const raw = u.avatarUrl || '';
    let avatar = '';
    if (raw.startsWith('cloud://')) avatar = urlMap[raw] || '';
    else if (raw.startsWith('https://') && !raw.includes('tmp') && !raw.includes('tcb.qcloud.la')) avatar = raw;
    return {
      ...u,
      avatarUrl: avatar,
      groupName: (u.groupIds || []).map(id => groupMap[id] || '').filter(Boolean).join('、') || '未加入',
      // 无效成绩（如 0000）展示为空
      _pb10k: fmtPB(u.pb10k),
      _pbHalf: fmtPB(u.pbHalf),
      _pbFull: fmtPB(u.pbFull),
    };
  },

  async loadUsers() {
    this.setData({ loading: true });
    try {
      const [usersRes, groupsRes] = await Promise.all([
        wx.cloud.callFunction({ name: 'searchUsers', data: { kw: '', sortBy: this.data.sortBy, sortAsc: this.data.sortAsc, page: 1, pageSize: this.data.pageSize } }),
        dbUtil.getGroups(),
      ]);
      const groupMap = {};
      groupsRes.data.forEach(g => { groupMap[g._id] = g.name; });
      const result = usersRes.result || {};
      const users = result.list || [];
      const cloudIds = users.filter(u => u.avatarUrl && u.avatarUrl.startsWith('cloud://')).map(u => u.avatarUrl);
      let urlMap = {};
      if (cloudIds.length) {
        try {
          const r = await wx.cloud.callFunction({ name: 'getImageUrls', data: { fileIDs: cloudIds } });
          (r.result || []).forEach(f => { if (f.tempFileURL) urlMap[f.fileID] = f.tempFileURL; });
        } catch {}
      }
      const allUsers = users.map(u => this.decorateUser(u, urlMap, groupMap));
      this.setData({ allUsers, totalCount: result.total || 0, loading: false, page: 1, hasMore: !!result.hasMore });
      this.applyFilter();
    } catch { this.setData({ loading: false }); }
  },

  onAvatarError(e) {
    const id = e.currentTarget.dataset.id;
    if (id) {
      const idx = this.data.allUsers.findIndex(u => u._id === id);
      if (idx !== -1) { this.setData({ ['allUsers[' + idx + '].avatarUrl']: '/imgs/back.svg' }); this.applyFilter(); }
    }
  },

  applyFilter() {
    let users = [...this.data.allUsers];
    const kw = this.data.searchKey.toLowerCase();
    if (kw) {
      users = users.filter(u =>
        (u.nickName || '').toLowerCase().includes(kw) ||
        (u.city || '').toLowerCase().includes(kw) ||
        (u.groupName || '').toLowerCase().includes(kw)
      );
    }
    const by = this.data.sortBy, asc = this.data.sortAsc;
    users.sort((a, b) => {
      if (by === 'name') return asc ? (a.nickName||'').localeCompare(b.nickName||'') : (b.nickName||'').localeCompare(a.nickName||'');
      if (by === 'pb10k' || by === 'pbHalf' || by === 'pbFull') {
        const minSec = { pb10k: 1680, pbHalf: 3600, pbFull: 7200 }[by] || 0; // 10K≥28分/半马≥1h/全马≥2h
        const sa = toSec(a[by]), sb = toSec(b[by]);
        const ha = sa >= minSec, hb = sb >= minSec;
        // 没成绩/无效成绩（如 0000）不参与排名：恒排最后
        if (ha !== hb) return ha ? -1 : 1;
        if (!ha) return (a.createTime || 0) - (b.createTime || 0) || (a._id || '').localeCompare(b._id || '');
        if (sa !== sb) return asc ? sa - sb : sb - sa;
        return 0;
      }
      return asc ? a.createTime - b.createTime : b.createTime - a.createTime;
    });
    this.setData({ users });
  },

  onSearchBlur(e) { this.onSearchInput(e); },

  onSearchInput(e) {
    const kw = e.detail.value || '';
    this.setData({ searchKey: kw });
    if (kw) { this.searchUsers(kw); }
    else { this.loadUsers(); }
  },

  async searchUsers(kw) {
    this.setData({ loading: true });
    try {
      const res = await wx.cloud.callFunction({ name: 'searchUsers', data: { kw, sortBy: this.data.sortBy, sortAsc: this.data.sortAsc, page: 1, pageSize: this.data.pageSize } });
      const result = res.result || {};
      const list = result.list || [];
      const groupsRes = await dbUtil.getGroups();
      const groupMap = {};
      groupsRes.data.forEach(g => { groupMap[g._id] = g.name; });
      const cloudIds = list.filter(u => u.avatarUrl && u.avatarUrl.startsWith('cloud://')).map(u => u.avatarUrl);
      let urlMap = {};
      if (cloudIds.length) {
        try {
          const r = await wx.cloud.callFunction({ name: 'getImageUrls', data: { fileIDs: cloudIds } });
          (r.result || []).forEach(f => { if (f.tempFileURL) urlMap[f.fileID] = f.tempFileURL; });
        } catch {}
      }
      const all = list.map(u => this.decorateUser(u, urlMap, groupMap));
      this.setData({ allUsers: all, totalCount: result.total || 0, loading: false, page: 1, hasMore: !!result.hasMore });
      this.applyFilter();
    } catch { this.setData({ loading: false }); }
  },

  onSortBy(e) {
    const by = e.currentTarget.dataset.by;
    if (this.data.sortBy === by) { this.setData({ sortAsc: !this.data.sortAsc }); }
    else { this.setData({ sortBy: by, sortAsc: false }); }
    // 服务端全局排序：重新拉取
    if (this.data.searchKey) { this.searchUsers(this.data.searchKey); }
    else { this.loadUsers(); }
  },

  async onViewUser(e) {
    const { id } = e.currentTarget.dataset;
    const user = this.data.allUsers.find(u => u._id === id);
    if (!user) return;
    let raceRecords = [];
    try {
      const rr = await dbUtil.db.collection('race_records').where({ userId: id, isPublic: true }).orderBy('date', 'desc').limit(3).get();
      raceRecords = rr.data.map(r => ({
        ...r,
        typeName: r.raceType === '10k' ? '10K' : r.raceType === 'half' ? '半马' : r.raceType === 'trail' ? '越野跑' : '全马',
        statusName: r.status === 'planned' ? '计划报名' : r.status === 'finished' ? '已完赛' : r.status === 'dnf' ? '未完赛' : r.status === 'dns' ? '弃赛' : r.status === 'won' ? '已中签' : '已报名',
      }));
    } catch {}
    this.setData({ showDetail: true, detailUser: user, detailGroups: user.groupName, detailRaces: raceRecords });
  },

  onViewAllRaces() {
    const u = this.data.detailUser;
    wx.navigateTo({ url: '/pages/records/public?userId=' + u._id + '&userName=' + (u.nickName || '') });
  },

  onHideDetail() { this.setData({ showDetail: false }); },

  onReachBottom() { if (this.data.hasMore && !this.data.loading) this.loadMore(); },

  async loadMore() {
    if (!this.data.hasMore || this.data.loading) return;
    const page = this.data.page + 1;
    this.setData({ loading: true });
    try {
      const res = await wx.cloud.callFunction({ name: 'searchUsers', data: { kw: this.data.searchKey, sortBy: this.data.sortBy, sortAsc: this.data.sortAsc, page, pageSize: this.data.pageSize } });
      const result = res.result || {};
      const newUsers = result.list || [];
      const groupsRes = await dbUtil.getGroups();
      const groupMap = {};
      groupsRes.data.forEach(g => { groupMap[g._id] = g.name; });
      const cloudIds = newUsers.filter(u => u.avatarUrl && u.avatarUrl.startsWith('cloud://')).map(u => u.avatarUrl);
      let urlMap = {};
      if (cloudIds.length) {
        try {
          const r = await wx.cloud.callFunction({ name: 'getImageUrls', data: { fileIDs: cloudIds } });
          (r.result || []).forEach(f => { if (f.tempFileURL) urlMap[f.fileID] = f.tempFileURL; });
        } catch {}
      }
      const decorated = newUsers.map(u => this.decorateUser(u, urlMap, groupMap));
      this.setData({ allUsers: [...this.data.allUsers, ...decorated], page, hasMore: !!result.hasMore, loading: false });
      this.applyFilter();
    } catch { this.setData({ loading: false }); }
  },
});
