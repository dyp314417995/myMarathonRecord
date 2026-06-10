// pages/admin/members/members.js - 跑友名录（只读）
const dbUtil = require('../../../utils/db');

Page({
  data: {
    allUsers: [], users: [], loading: true,
    searchKey: '', sortBy: 'time', sortAsc: false,
    showDetail: false, detailUser: {}, detailGroups: '',
    hasMore: false,
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
      if (this.data.allUsers.length > 20) {
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
    while (true) {
      const res = await dbUtil.getUserList({}, all.length, 20);
      if (res.data.length === 0) break;
      all = all.concat(res.data.map(u => ({
        ...u,
        groupName: (u.groupIds || []).map(id => groupMap[id] || '').filter(Boolean).join('、') || '未加入',
      })));
    }
    const allCloudIds = all.filter(u => u.avatarUrl && u.avatarUrl.startsWith('cloud://')).map(u => u.avatarUrl);
    if (allCloudIds.length) {
      try {
        const r = await wx.cloud.callFunction({ name: 'getImageUrls', data: { fileIDs: allCloudIds } });
        const urlMap = {};
        (r.result || []).forEach(f => { if (f.tempFileURL) urlMap[f.fileID] = f.tempFileURL; });
        all = all.map(u => (u.avatarUrl && u.avatarUrl.startsWith('cloud://') ? { ...u, avatarUrl: urlMap[u.avatarUrl] || '' } : u));
      } catch {}
    }
    this.setData({ allUsers: all, hasMore: false, loading: false });
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

  onViewUser(e) {
    const { id } = e.currentTarget.dataset;
    const user = this.data.allUsers.find(u => u._id === id);
    if (!user) return;
    this.setData({
      showDetail: true,
      detailUser: user,
      detailGroups: user.groupName,
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
