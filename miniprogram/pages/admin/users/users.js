// pages/admin/users/users.js - 用户管理（搜索/详情/移除）
const dbUtil = require('../../../utils/db');
const cache = require('../../../utils/cache');
const pointsUtil = require('../../../utils/points');

const LIST_CACHE_KEY = 'users_all_users';
const LIST_CACHE_TTL = 5 * 60 * 1000; // 5 分钟

const PAGE_SIZE = 20;

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
    allUsers: [],
    users: [],
    loading: true,
    searchKey: '',
    sortBy: 'time',
    sortAsc: false,
    isSuperAdmin: false,
    // 详情弹窗
    showDetail: false,
    detailUser: null,
    detailGroups: '',
    detailPoints: 0,
    totalCount: 0,
    hasMore: false,
    visibleCount: PAGE_SIZE,
  },

  async onShow() {
    const userInfo = wx.getStorageSync('userInfo') || {};
    this.setData({ isSuperAdmin: userInfo.role === 'super_admin' });
    await this.loadUsers();
  },

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
          const res = await dbUtil.getUserList({}, skip, PAGE_SIZE);
          if (!res.data.length) break;
          res.data.forEach(u => { if (u._id && !seen.has(u._id)) { seen.add(u._id); all.push(u); } });
          if (res.data.length < PAGE_SIZE) break;
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

        const users = all.map(u => {
          const raw = u.avatarUrl || '';
          let avatar = '';
          if (raw.startsWith('cloud://')) avatar = urlMap[raw] || '';
          else if (raw.startsWith('https://') && !raw.includes('tmp') && !raw.includes('tcb.qcloud.la')) avatar = raw;
          // 其他格式（wxfile://、temp https、过期云链接等）清空走默认头像
          return {
            ...u, avatarUrl: avatar,
            groupName: (u.groupIds || []).map(id => groupMap[id] || '').filter(Boolean).join('、') || '未加入',
          };
        });

        return { list: users, total: totalCount };
      }, { ttl: LIST_CACHE_TTL, force, versionKey: 'users' });

      this.setData({ allUsers: data.list, totalCount: data.total, loading: false });
      this.applyFilter();
    } catch (err) {
      this.setData({ loading: false });
    }
  },

  // 头像加载失败时回退到默认图
  onAvatarError(e) {
    const id = e.currentTarget.dataset.id;
    if (id) {
      const idx = this.data.allUsers.findIndex(u => u._id === id);
      if (idx !== -1) {
        this.setData({ [`allUsers[${idx}].avatarUrl`]: '/imgs/back.svg' });
        this.applyFilter();
      }
    }
  },

  // 全局过滤 + 排序 + 切片分页（allUsers 含全部用户，因此排序是全局的）
  applyFilter() {
    let list = [...this.data.allUsers];
    // 搜索
    const kw = this.data.searchKey.trim().toLowerCase();
    if (kw) {
      list = list.filter(u =>
        (u.nickName || '').toLowerCase().includes(kw) ||
        (u.city || '').toLowerCase().includes(kw) ||
        (u.groupName || '').toLowerCase().includes(kw)
      );
    }
    // 排序
    const sortBy = this.data.sortBy;
    const asc = this.data.sortAsc;
    if (sortBy === 'name') {
      list.sort((a, b) => asc ? (b.nickName || '').localeCompare(a.nickName || '') : (a.nickName || '').localeCompare(b.nickName || ''));
    } else if (sortBy === 'pb10k' || sortBy === 'pbHalf' || sortBy === 'pbFull') {
      list.sort((a, b) => {
        const sa = toSeconds(a[sortBy]), sb = toSeconds(b[sortBy]);
        const ha = sa !== null, hb = sb !== null;
        // 没成绩（或成绩非法）的不参与排名：有成绩的排前，没成绩的恒排最后
        if (ha !== hb) return ha ? -1 : 1;
        if (!ha) return (a.createTime || 0) - (b.createTime || 0) || (a._id || '').localeCompare(b._id || '');
        return asc ? sb - sa : sa - sb;
      });
    } else {
      list.sort((a, b) => asc ? (a.createTime || 0) - (b.createTime || 0) : (b.createTime || 0) - (a.createTime || 0));
    }
    const visible = list.slice(0, this.data.visibleCount);
    this.setData({ users: visible, hasMore: visible.length < list.length, loading: false });
  },

  // 搜索（本地全量过滤）
  onSearchBlur(e) {
    this.onSearchInput(e);
  },

  onSearchInput(e) {
    const kw = e.detail.value || '';
    this.setData({ searchKey: kw, visibleCount: PAGE_SIZE });
    this.applyFilter();
  },

  // 排序
  onSortBy(e) {
    const by = e.currentTarget.dataset.by;
    if (this.data.sortBy === by) {
      this.setData({ sortAsc: !this.data.sortAsc });
    } else {
      this.setData({ sortBy: by, sortAsc: false });
    }
    this.setData({ visibleCount: PAGE_SIZE });
    this.applyFilter();
  },

  // 用户详情
  async onViewUser(e) {
    const { id } = e.currentTarget.dataset;
    const user = this.data.allUsers.find(u => u._id === id);
    if (!user) return;

    let detailPoints = user.points || 0;

    // 格式化时间
    const created = user.createTime ? this.fmtDate(user.createTime) : '未知';

    this.setData({
      showDetail: true,
      detailUser: user,
      detailGroups: user.groupName,
      detailPoints,
      detailCreated: created,
    });
  },

  onHideDetail() { this.setData({ showDetail: false }); },

  onReachBottom() {
    if (this.data.hasMore) this.loadMore();
  },

  // 加载更多：从已排序的全局结果里多展示一页（切片方式，天然不会重复）
  loadMore() {
    if (!this.data.hasMore) return;
    this.setData({ visibleCount: this.data.visibleCount + PAGE_SIZE });
    this.applyFilter();
  },

  async onDemoteAdmin(e) {
    const { id, name } = e.currentTarget.dataset;
    wx.showModal({
      title: '解除管理员',
      content: `确认将"${name}"降为普通用户？`,
      confirmColor: '#ff4d4f',
      success: async (res) => {
        if (!res.confirm) return;
        // 标记 admin 记录为 revoked
        await dbUtil.db.collection('admins').where({ userId: id, status: 'active' })
          .update({ data: { status: 'revoked' } });
        // 改用户角色
        await dbUtil.updateUser(id, { role: 'user' });
        wx.showToast({ title: '已解除', icon: 'success' });
        cache.invalidate('users'); cache.invalidate('members');
        this.loadUsers(true);
      }
    });
  },

  fmtDate(d) {
    const dt = new Date(d);
    return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
  },

  onDeleteUser(e) {
    const { id, name } = e.currentTarget.dataset;
    wx.showModal({
      title: '确认删除',
      content: `确认删除用户"${name}"？删除后该用户可重新注册。`,
      confirmColor: '#ff4d4f',
      success: async (res) => {
        if (!res.confirm) return;
        // 更新群成员数
        const user = this.data.allUsers.find(u => u._id === id);
        if (user && user.groupIds) {
          for (const gid of user.groupIds) {
            dbUtil.db.collection('groups').doc(gid).update({ data: { memberCount: dbUtil._.inc(-1) } }).catch(() => {});
          }
        }
        // 清除管理员记录
        if (user && user.role === 'admin') {
          dbUtil.db.collection('admins').where({ userId: id, status: 'active' })
            .update({ data: { status: 'revoked' } }).catch(() => {});
        }
        await dbUtil.db.collection('users').doc(id).remove();
        wx.showToast({ title: '已删除', icon: 'success' });
        cache.invalidate('users'); cache.invalidate('members');
        this.loadUsers(true);
      }
    });
  },
});
