// pages/admin/members/members.js - 跑友名录（只读）
const dbUtil = require('../../../utils/db');

Page({
  data: {
    allUsers: [], users: [], loading: true,
    searchKey: '', sortBy: 'time', sortAsc: false,
    totalCount: 0,
    showDetail: false, detailUser: {}, detailGroups: '', detailRaces: [],
    hasMore: false,
    _allLoaded: false,
  },

  async onShow() { this.loadUsers(); },

  async loadUsers() {
    this.setData({ loading: true });
    try {
      const [usersRes, groupsRes] = await Promise.all([dbUtil.getUserList({}, 0, 20), dbUtil.getGroups()]);
      const groupMap = {};
      groupsRes.data.forEach(g => { groupMap[g._id] = g.name; });

      const cloudIds = usersRes.data.filter(u => u.avatarUrl && u.avatarUrl.startsWith('cloud://')).map(u => u.avatarUrl);
      let urlMap = {};
      if (cloudIds.length) {
        try {
          const r = await wx.cloud.callFunction({ name: 'getImageUrls', data: { fileIDs: cloudIds } });
          (r.result || []).forEach(f => { if (f.tempFileURL) urlMap[f.fileID] = f.tempFileURL; });
        } catch {}
      }

      const allUsers = usersRes.data.map(u => {
        const raw = u.avatarUrl || '';
        let avatar = '';
        if (raw.startsWith('cloud://')) avatar = urlMap[raw] || '';
        else if (raw.startsWith('https://') && !raw.includes('tmp')) avatar = raw;
        // 其他格式（临时路径等）清空走默认头像
        return {
          ...u, avatarUrl: avatar,
          groupName: (u.groupIds || []).map(id => groupMap[id] || '').filter(Boolean).join('、') || '未加入',
        };
      });
      const totalCount = await dbUtil.getUserCount();
      this.setData({ allUsers, totalCount, loading: false, hasMore: usersRes.data.length >= 20 });
      this.applyFilter();
    } catch { this.setData({ loading: false }); }
  },

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
    const by = this.data.sortBy;
    const asc = this.data.sortAsc;
    users.sort((a, b) => {
      let va, vb;
      if (by === 'name') { va = a.nickName || ''; vb = b.nickName || ''; return asc ? va.localeCompare(vb) : vb.localeCompare(va); }
      if (by === 'pb10k' || by === 'pbHalf' || by === 'pbFull') {
        const pa = a[by] || '', pb = b[by] || '';
        return asc ? pa.localeCompare(pb) : pb.localeCompare(pa);
      }
      return asc ? a.createTime - b.createTime : b.createTime - a.createTime;
    });
    this.setData({ users });
  },

  onSearchInput(e) {
    const kw = e.detail.value || '';
    this.setData({ searchKey: kw });
    if (kw) {
      this.searchUsers(kw);
    } else {
      this.loadUsers();
    }
  },

  async searchUsers(kw) {
    this.setData({ loading: true, _allLoaded: true });
    try {
      const regex = dbUtil.db.RegExp({ regexp: kw, options: 'i' });
      const [nameRes, cityRes] = await Promise.all([
        dbUtil.db.collection('users').where({ nickName: regex }).limit(50).get(),
        dbUtil.db.collection('users').where({ city: regex }).limit(50).get(),
      ]);
      const seen = new Set();
      const uniqueUsers = [];
      const groupsRes = await dbUtil.getGroups();
      const groupMap = {};
      groupsRes.data.forEach(g => { groupMap[g._id] = g.name; });
      const processUser = (u) => {
        if (seen.has(u._id)) return;
        seen.add(u._id);
        uniqueUsers.push(u);
      };
      (nameRes.data || []).forEach(processUser);
      (cityRes.data || []).forEach(processUser);
      const cloudIds = uniqueUsers.filter(u => u.avatarUrl && u.avatarUrl.startsWith('cloud://')).map(u => u.avatarUrl);
      const urlMap = {};
      for (let i = 0; i < cloudIds.length; i += 50) {
        try {
          const batch = cloudIds.slice(i, i + 50);
          const r = await wx.cloud.callFunction({ name: 'getImageUrls', data: { fileIDs: batch } });
          (r.result || []).forEach(f => { if (f.tempFileURL) urlMap[f.fileID] = f.tempFileURL; });
        } catch {}
      }
      const all = uniqueUsers.map(u => {
        const raw = u.avatarUrl || '';
        let avatar = '';
        if (raw.startsWith('cloud://')) avatar = urlMap[raw] || '';
        else if (raw.startsWith('https://') && !raw.includes('tmp')) avatar = raw;
        return {
          ...u, avatarUrl: avatar,
          groupName: (u.groupIds || []).map(id => groupMap[id] || '').filter(Boolean).join('、') || '未加入',
        };
      });
      this.setData({ allUsers: all, hasMore: false, loading: false });
      this.applyFilter();
    } catch { this.setData({ loading: false }); }
  },

  onSortBy(e) {
    const by = e.currentTarget.dataset.by;
    if (this.data.sortBy === by) {
      this.setData({ sortAsc: !this.data.sortAsc });
    } else {
      this.setData({ sortBy: by, sortAsc: false });
    }
    this.applyFilter();
  },

  async onViewUser(e) {
    const { id } = e.currentTarget.dataset;
    const user = this.data.allUsers.find(u => u._id === id);
    if (!user) return;
    // 拉最近的 3 条公开记录预览
    let raceRecords = [];
    try {
      const rr = await dbUtil.db.collection('race_records').where({ userId: id, isPublic: true }).orderBy('date', 'desc').limit(3).get();
      raceRecords = rr.data.map(r => ({
        ...r,
        typeName: r.raceType === '10k' ? '10K' : r.raceType === 'half' ? '半马' : r.raceType === 'trail' ? '越野跑' : '全马',
        statusName: r.status === 'planned' ? '计划报名' : r.status === 'finished' ? '已完赛' : r.status === 'dnf' ? '未完赛' : r.status === 'dns' ? '弃赛' : r.status === 'won' ? '已中签' : '已报名',
      }));
    } catch {}
    this.setData({
      showDetail: true,
      detailUser: user,
      detailGroups: user.groupName,
      detailRaces: raceRecords,
    });
  },

  onViewAllRaces() {
    const u = this.data.detailUser;
    wx.navigateTo({ url: '/pages/records/public?userId=' + u._id + '&userName=' + (u.nickName || '') });
  },

  onHideDetail() { this.setData({ showDetail: false }); },

  onReachBottom() {
    if (this.data.hasMore) this.loadMore();
  },

  async loadMore() {
    if (this.data.searchKey) return; // 搜索模式不支持分页
    const existingIds = new Set(this.data.allUsers.map(u => u._id));
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
    const newUsers = res.data
      .filter(u => !existingIds.has(u._id))
      .map(u => {
        const raw = u.avatarUrl || '';
        let avatar = '';
        if (raw.startsWith('cloud://')) avatar = urlMap[raw] || '';
        else if (raw.startsWith('https://') && !raw.includes('tmp')) avatar = raw;
        return {
          ...u, avatarUrl: avatar,
          groupName: (u.groupIds || []).map(id => groupMap[id] || '').filter(Boolean).join('、') || '未加入',
        };
      });
    const all = [...this.data.allUsers, ...newUsers];
    this.setData({ allUsers: all, hasMore: res.data.length >= 20 });
    this.applyFilter();
  },
});
