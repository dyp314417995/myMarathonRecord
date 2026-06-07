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
    // 详情弹窗
    showDetail: false,
    detailUser: null,
    detailGroups: '',
    detailPoints: 0,
  },

  async onShow() {
    await this.loadUsers();
  },

  async loadUsers() {
    this.setData({ loading: true });
    try {
      const res = await dbUtil.getUserList();
      const groupsRes = await dbUtil.getGroups();
      const groupMap = {};
      groupsRes.data.forEach(g => { groupMap[g._id] = g.name; });

      const users = res.data.map(u => ({
        ...u,
        groupName: (u.groupIds || []).map(id => groupMap[id] || '').filter(Boolean).join('、') || '未加入',
      }));
      this.setData({ allUsers: users });
      this.applyFilter();
    } catch (err) {
      this.setData({ loading: false });
    }
  },

  // 搜索
  onSearchInput(e) {
    this.setData({ searchKey: e.detail.value });
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

    // 获取积分余额
    let detailPoints = 0;
    try { detailPoints = await pointsUtil.getBalance(id); } catch {}

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

  fmtDate(d) {
    const dt = new Date(d);
    return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
  },

  onRemoveUser(e) {
    const { id, name } = e.currentTarget.dataset;
    wx.showModal({
      title: '确认移除',
      content: `确认将用户"${name}"移出群组？`,
      confirmColor: '#ff4d4f',
      success: async (res) => {
        if (!res.confirm) return;
        await dbUtil.updateUser(id, { groupIds: [], status: 'approved' });
        wx.showToast({ title: '已移除', icon: 'success' });
        this.loadUsers();
      }
    });
  },
});
