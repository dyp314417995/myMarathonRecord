// pages/admin/users/users.js - 用户管理（搜索/详情/移除）
const dbUtil = require('../../../utils/db');
const pointsUtil = require('../../../utils/points');

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
    _allLoaded: false,
  },

  async onShow() {
    const userInfo = wx.getStorageSync('userInfo') || {};
    this.setData({ isSuperAdmin: userInfo.role === 'super_admin' });
    await this.loadUsers();
  },

  async loadUsers() {
    this.setData({ loading: true });
    this.setData({ loading: true });
    try {
      const res = await dbUtil.getUserList({}, 0, 20);
      const groupsRes = await dbUtil.getGroups();
      const groupMap = {};
      groupsRes.data.forEach(g => { groupMap[g._id] = g.name; });

      // 批量转换 cloud:// 头像（云函数绕过权限）
      const cloudIds = res.data.filter(u => u.avatarUrl && u.avatarUrl.startsWith('cloud://')).map(u => u.avatarUrl);
      let urlMap = {};
      if (cloudIds.length) {
        try {
          const r = await wx.cloud.callFunction({ name: 'getImageUrls', data: { fileIDs: cloudIds } });
          (r.result || []).forEach(f => { if (f.tempFileURL) urlMap[f.fileID] = f.tempFileURL; });
        } catch {}
      }

      const users = res.data.map(u => {
        const raw = u.avatarUrl || '';
        let avatar = '';
        if (raw.startsWith('cloud://')) avatar = urlMap[raw] || '';
        else if (raw.startsWith('https://') && !raw.includes('tmp')) avatar = raw;
        // 其他格式（wxfile://、temp https等）都是临时路径，清空走默认头像
        return {
          ...u, avatarUrl: avatar,
          groupName: (u.groupIds || []).map(id => groupMap[id] || '').filter(Boolean).join('、') || '未加入',
        };
      });
      const totalCount = await dbUtil.getUserCount();
      const hasMore = res.data.length >= 20;
      this.setData({ allUsers: users, hasMore, totalCount, loading: false });
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

  async loadMore() {
    const skip = this.data.allUsers.length;
    const res = await dbUtil.getUserList({}, skip, 20);
    if (res.data.length === 0) return this.setData({ hasMore: false });

    const groupsRes = await dbUtil.getGroups();
    const groupMap = {};
    groupsRes.data.forEach(g => { groupMap[g._id] = g.name; });

    const cloudIds = res.data.filter(u => u.avatarUrl && u.avatarUrl.startsWith('cloud://')).map(u => u.avatarUrl);
    let urlMap = {};
    if (cloudIds.length) {
      try {
        const r = await wx.cloud.callFunction({ name: 'getImageUrls', data: { fileIDs: cloudIds } });
        (r.result || []).forEach(f => { if (f.tempFileURL) urlMap[f.fileID] = f.tempFileURL; });
      } catch {}
    }
    const newUsers = res.data.map(u => {
      let avatar = u.avatarUrl || '';
      if (avatar.startsWith('cloud://')) avatar = urlMap[avatar] || '';
      else if (!avatar.startsWith('https://')) avatar = '';
      return {
        ...u, avatarUrl: avatar,
        groupName: (u.groupIds || []).map(id => groupMap[id] || '').filter(Boolean).join('、') || '未加入',
      };
    });
    const all = [...this.data.allUsers, ...newUsers];
    const hasMore = res.data.length >= 20;
    this.setData({ allUsers: all, hasMore });
    this.applyFilter();
  },

  // 搜索
  onSearchInput(e) {
    const kw = e.detail.value || '';
    this.setData({ searchKey: kw });
    if (kw) {
      if (this.data._allLoaded) {
        this.applyFilter();
      } else {
        this.loadAllUsers().then(() => this.applyFilter());
      }
    } else {
      this.applyFilter();
    }
  },

  async loadAllUsers() {
    this.setData({ loading: true });
    const groupsRes = await dbUtil.getGroups();
    const groupMap = {};
    groupsRes.data.forEach(g => { groupMap[g._id] = g.name; });
    let all = [];
    // 最多加载 100 条（5 页），再多就走分页
    for (let p = 0; p < 5; p++) {
      const res = await dbUtil.getUserList({}, p * 20, 20);
      if (res.data.length === 0) break;
      all = all.concat(res.data.map(u => ({
        ...u,
        groupName: (u.groupIds || []).map(id => groupMap[id] || '').filter(Boolean).join('、') || '未加入',
      })));
    }
    // 批量转换头像（每批最多50个，微信限制）
    const allCloudIds = all.filter(u => u.avatarUrl && u.avatarUrl.startsWith('cloud://')).map(u => u.avatarUrl);
    const urlMap = {};
    for (let i = 0; i < allCloudIds.length; i += 50) {
      try {
        const batch = allCloudIds.slice(i, i + 50);
        const r = await wx.cloud.callFunction({ name: 'getImageUrls', data: { fileIDs: batch } });
        (r.result || []).forEach(f => { if (f.tempFileURL) urlMap[f.fileID] = f.tempFileURL; });
      } catch {}
    }
    if (Object.keys(urlMap).length > 0) {
      all = all.map(u => {
        if (u.avatarUrl && u.avatarUrl.startsWith('cloud://')) {
          return { ...u, avatarUrl: urlMap[u.avatarUrl] || '' };
        }
        return u;
      });
    }
    this.setData({ allUsers: all, hasMore: false, _allLoaded: true });
  },

  // 排序
  onSortBy(e) {
    const by = e.currentTarget.dataset.by;
    if (this.data.sortBy === by) {
      this.setData({ sortAsc: !this.data.sortAsc });
    } else {
      this.setData({ sortBy: by, sortAsc: false });
    }
    this.applyFilter();
  },

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
      list.sort((a, b) => (a.nickName || '').localeCompare(b.nickName || ''));
    } else if (sortBy === 'pb10k') {
      list.sort((a, b) => (a.pb10k || '9').localeCompare(b.pb10k || '9'));
    } else if (sortBy === 'pbHalf') {
      list.sort((a, b) => (a.pbHalf || '9').localeCompare(b.pbHalf || '9'));
    } else if (sortBy === 'pbFull') {
      list.sort((a, b) => (a.pbFull || '9').localeCompare(b.pbFull || '9'));
    }
    if (asc) list.reverse();
    this.setData({ users: list, loading: false });
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
        this.loadUsers();
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
        this.loadUsers();
      }
    });
  },
});
