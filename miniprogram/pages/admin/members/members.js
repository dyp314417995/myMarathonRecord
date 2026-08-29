// pages/admin/members/members.js - 跑友名录
const dbUtil = require('../../../utils/db');
const cache = require('../../../utils/cache');

const PAGE_SIZE = 20;
const LIST_CACHE_KEY = 'members_all_users';
const LIST_CACHE_TTL = 5 * 60 * 1000; // 5 分钟

// 成绩字符串转秒（支持 H:MM:SS / MM:SS / 纯秒），非法返回 null
function toSeconds(t) {
  if (!t || typeof t !== 'string') return null;
  const p = t.trim().split(':').map(x => parseInt(x, 10));
  if (p.length === 0 || p.some(x => isNaN(x))) return null;
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  if (p.length === 2) return p[0] * 60 + p[1];
  return p[0];
}

Page({
  data: {
    allUsers: [], users: [], loading: true,
    searchKey: '', sortBy: 'time', sortAsc: false,
    totalCount: 0,
    showDetail: false, detailUser: {}, detailGroups: '', detailRaces: [],
    hasMore: false,
    visibleCount: PAGE_SIZE,
  },

  async onShow() { this.loadUsers(); },

  // 拉取全部用户（客户端单次最多20条，循环取完），保证排序是全局排序
  // 缓存未过期时直接使用本地缓存，不查库；只有查库成功才更新缓存
  async loadUsers(force = false) {
    // 缓存命中时直接展示，避免闪加载
    const cached = !force ? cache.get(LIST_CACHE_KEY) : null;
    this.setData({ loading: !cached, visibleCount: PAGE_SIZE });
    try {
      const { data } = await cache.load(LIST_CACHE_KEY, async () => {
        const [groupsRes, totalCount] = await Promise.all([dbUtil.getGroups(), dbUtil.getUserCount()]);
        const groupMap = {};
        groupsRes.data.forEach(g => { groupMap[g._id] = g.name; });

        const all = [];
        const seen = new Set();
        let skip = 0;
        for (;;) {
          const page = await dbUtil.getUserList({}, skip, PAGE_SIZE);
          if (!page.data.length) break;
          page.data.forEach(u => { if (u._id && !seen.has(u._id)) { seen.add(u._id); all.push(u); } });
          if (page.data.length < PAGE_SIZE) break;
          skip += PAGE_SIZE;
        }

        // 批量转换 cloud:// 头像（云函数绕过权限，50 个一批）
        const allCloudIds = all.filter(u => u.avatarUrl && u.avatarUrl.startsWith('cloud://')).map(u => u.avatarUrl);
        const urlMap = {};
        for (let i = 0; i < allCloudIds.length; i += 50) {
          try {
            const r = await wx.cloud.callFunction({ name: 'getImageUrls', data: { fileIDs: allCloudIds.slice(i, i + 50) } });
            (r.result || []).forEach(f => { if (f.tempFileURL) urlMap[f.fileID] = f.tempFileURL; });
          } catch {}
        }

        const allUsers = all.map(u => {
          const raw = u.avatarUrl || '';
          let avatar = '';
          if (raw.startsWith('cloud://')) avatar = urlMap[raw] || '';
          else if (raw.startsWith('https://') && !raw.includes('tmp') && !raw.includes('tcb.qcloud.la')) avatar = raw;
          return { ...u, avatarUrl: avatar, groupName: (u.groupIds || []).map(id => groupMap[id] || '').filter(Boolean).join('、') || '未加入' };
        });

        return { list: allUsers, total: totalCount };
      }, { ttl: LIST_CACHE_TTL, force, versionKey: 'members' });

      this.setData({ allUsers: data.list, totalCount: data.total, loading: false });
      this.applyFilter();
    } catch { this.setData({ loading: false }); }
  },

  onAvatarError(e) {
    const id = e.currentTarget.dataset.id;
    if (id) {
      const idx = this.data.allUsers.findIndex(u => u._id === id);
      if (idx !== -1) { this.setData({ [`allUsers[${idx}].avatarUrl`]: '/imgs/back.svg' }); this.applyFilter(); }
    }
  },

  // 全局过滤 + 排序 + 切片分页（allUsers 含全部用户，因此排序是全局的）
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
        const sa = toSeconds(a[by]), sb = toSeconds(b[by]);
        const ha = sa !== null, hb = sb !== null;
        // 没成绩（或成绩非法）的不参与排名：有成绩的排前，没成绩的恒排最后
        if (ha !== hb) return ha ? -1 : 1;
        if (!ha) return (a.createTime || 0) - (b.createTime || 0) || (a._id || '').localeCompare(b._id || '');
        return asc ? sa - sb : sb - sa;
      }
      return asc ? a.createTime - b.createTime : b.createTime - a.createTime;
    });
    const visible = users.slice(0, this.data.visibleCount);
    this.setData({ users: visible, hasMore: visible.length < users.length });
  },

  onSearchBlur(e) { this.onSearchInput(e); },

  onSearchInput(e) {
    const kw = e.detail.value || '';
    this.setData({ searchKey: kw, visibleCount: PAGE_SIZE });
    this.applyFilter();
  },

  onSortBy(e) {
    const by = e.currentTarget.dataset.by;
    const patch = { visibleCount: PAGE_SIZE };
    if (this.data.sortBy === by) {
      patch.sortAsc = !this.data.sortAsc;
    } else {
      // PB 成绩默认最快在前（升序），其他保持原有默认
      const isPb = by === 'pb10k' || by === 'pbHalf' || by === 'pbFull';
      patch.sortBy = by;
      patch.sortAsc = isPb ? true : false;
    }
    this.setData(patch);
    this.applyFilter();
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
        typeName: r.raceType === '10k' ? '10K' : r.raceType === 'half' ? '半马' : '全马',
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

  onReachBottom() { if (this.data.hasMore) this.loadMore(); },

  // 加载更多：从已排序的全局结果里多展示一页（切片方式，天然不会重复）
  loadMore() {
    if (!this.data.hasMore) return;
    this.setData({ visibleCount: this.data.visibleCount + PAGE_SIZE });
    this.applyFilter();
  },
});
