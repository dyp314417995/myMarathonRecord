// pages/admin/members/members.js - 跑友名录（只读）
const dbUtil = require('../../../utils/db');

Page({
  data: {
    allUsers: [], users: [], loading: true,
    searchKey: '', sortBy: 'time', sortAsc: false,
    showDetail: false, detailUser: {}, detailGroups: '', detailRaces: [],
    hasMore: false,
    _allLoaded: false,
  },

  async onShow() { this.loadUsers(); },

  async loadUsers() {
    this.setData({ loading: true });
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
        let avatar = u.avatarUrl || '';
        if (avatar.startsWith('cloud://')) avatar = urlMap[avatar] || '';
        else if (!avatar.startsWith('https://')) avatar = '';
        return {
          ...u, avatarUrl: avatar,
          groupName: (u.groupIds || []).map(id => groupMap[id] || '').filter(Boolean).join('、') || '未加入',
        };
      });
      this.setData({ allUsers, loading: false, hasMore: usersRes.data.length >= 20 });
      this.applyFilter();
    } catch { this.setData({ loading: false }); }
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
    for (let p = 0; p < 5; p++) {
      const res = await dbUtil.getUserList({}, p * 20, 20);
      if (res.data.length === 0) break;
      all = all.concat(res.data.map(u => ({
        ...u,
        groupName: (u.groupIds || []).map(id => groupMap[id] || '').filter(Boolean).join('、') || '未加入',
      })));
    }
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
      all = all.map(u => (u.avatarUrl && u.avatarUrl.startsWith('cloud://') ? { ...u, avatarUrl: urlMap[u.avatarUrl] || '' } : u));
    }
    this.setData({ allUsers: all, hasMore: false, loading: false, _allLoaded: true });
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
    // 拉公开的跑马记录
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

  onHideDetail() { this.setData({ showDetail: false }); },

  onReachBottom() {
    if (this.data.hasMore) this.loadMore();
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
    this.setData({ allUsers: all, hasMore: res.data.length >= 20 });
    this.applyFilter();
  },
});
