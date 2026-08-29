// pages/admin/makeup-cards/makeup-cards.js - 管理员手动补发补签卡（指定用户 / 全员）
const dbUtil = require('../../../utils/db');

const FUNC = 'grantMakeupCard';
const LOG_PAGE_SIZE = 20;

Page({
  data: {
    loading: true,
    holdLimit: 10,
    expireDays: 30,
    // 指定用户
    showUserPicker: false,
    userFilter: '',
    users: [],
    filteredUsers: [],
    selectedUserIds: {},
    selectedUserNames: {},
    selectedCount: 0,
    selectedNamesText: '',
    selectedNamesMore: '',
    selectedNamesAll: '',
    showAllNames: false,
    userCount: '1',
    userGranting: false,
    // 全员
    allCount: '1',
    allGranting: false,
    // 发放记录
    logs: [],
    logsLoading: false,
    hasMoreLogs: false,
    logSkip: 0,
  },

  async onShow() {
    await this.load();
  },

  callFn(action, data = {}) {
    return wx.cloud.callFunction({ name: FUNC, data: { action, ...data } })
      .then(r => r.result || {})
      .catch(err => ({ ok: false, msg: '调用失败：' + (err && err.errMsg ? err.errMsg : '') }));
  },

  async load() {
    this.setData({ loading: true });
    const info = await this.callFn('info', {});
    this.setData({
      loading: false,
      holdLimit: (info && info.hold_limit) || 10,
      expireDays: (info && info.expire_days) || 30,
    });
    this.loadLogs(true);
  },

  // ========== 指定用户 ==========
  async loadUsers() {
    const res = await dbUtil.getUserList({}, 0, 20);
    this.setData({ users: res.data, filteredUsers: res.data });
  },

  onSearchUser(e) {
    const kw = e.detail.value || '';
    this.setData({ userFilter: kw });
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(async () => {
      if (kw) {
        const res = await dbUtil.getUserList({ nickName: dbUtil.db.RegExp({ regexp: kw, options: 'i' }) }, 0, 20);
        this.setData({ filteredUsers: res.data });
      } else {
        this.setData({ filteredUsers: this.data.users });
      }
    }, 200);
  },

  showUserPicker() {
    this.setData({ showUserPicker: true, userFilter: '' });
    if (!this.data.users || this.data.users.length === 0) this.loadUsers();
  },

  hideUserPicker() { this.setData({ showUserPicker: false }); },

  onSelectUser(e) {
    const { id, name } = e.currentTarget.dataset;
    const ids = { ...this.data.selectedUserIds };
    const namesObj = { ...(this.data.selectedUserNames || {}) };
    if (ids[id]) {
      delete ids[id]; delete namesObj[id];
    } else {
      ids[id] = true;
      namesObj[id] = name || '';
    }
    const labels = Object.keys(ids).map(uid => namesObj[uid]).filter(Boolean);
    const count = labels.length;
    const max = 5;
    let text = labels.slice(0, max).join('、');
    let more = '';
    if (count > max) { text += ' ...'; more = '等' + count + '人'; }
    const all = labels.join('、');
    this.setData({
      selectedUserIds: ids,
      selectedUserNames: namesObj,
      selectedCount: count,
      selectedNamesText: text,
      selectedNamesMore: more,
      selectedNamesAll: all,
      showAllNames: false,
    });
  },

  onToggleShowAll() { this.setData({ showAllNames: !this.data.showAllNames }); },

  onUserCountInput(e) { this.setData({ userCount: e.detail.value }); },

  async onGrantToUsers() {
    if (this.data.userGranting) return;
    const userIds = Object.keys(this.data.selectedUserIds);
    if (userIds.length === 0) return wx.showToast({ title: '请先选择用户', icon: 'none' });
    const count = parseInt(this.data.userCount, 10);
    if (isNaN(count) || count < 1) return wx.showToast({ title: '请输入发放数量', icon: 'none' });

    wx.showModal({
      title: '确认补发',
      content: '将为已选 ' + userIds.length + ' 位用户各补发 ' + count + ' 张补签卡（每人最多持有 ' + this.data.holdLimit + ' 张，已达上限者自动跳过）？',
      success: async (res) => {
        if (!res.confirm) return;
        this.setData({ userGranting: true });
        wx.showLoading({ title: '发放中...' });
        const r = await this.callFn('grant', { target: 'user', userIds, count });
        wx.hideLoading();
        this.setData({ userGranting: false });
        if (!r || !r.ok) {
          wx.showToast({ title: (r && r.msg) || '发放失败', icon: 'none' });
        } else {
          wx.showToast({ title: '已发放 ' + r.granted + ' 张', icon: 'success' });
          this.setData({ selectedUserIds: {}, selectedUserNames: {}, selectedCount: 0, selectedNamesText: '', selectedNamesMore: '', selectedNamesAll: '' });
          this.loadLogs(true);
        }
      },
    });
  },

  // ========== 全员补发 ==========
  onAllCountInput(e) { this.setData({ allCount: e.detail.value }); },

  async onGrantToAll() {
    if (this.data.allGranting) return;
    const count = parseInt(this.data.allCount, 10);
    if (isNaN(count) || count < 1) return wx.showToast({ title: '请输入发放数量', icon: 'none' });

    wx.showModal({
      title: '全员补发',
      content: '将给全部用户各补发 ' + count + ' 张补签卡（每人最多持有 ' + this.data.holdLimit + ' 张，已达上限者自动跳过）。确认执行？',
      confirmColor: '#ff4d4f',
      success: async (res) => {
        if (!res.confirm) return;
        this.setData({ allGranting: true });
        wx.showLoading({ title: '全员发放中，请稍候...' });
        const r = await this.callFn('grant', { target: 'all', count });
        wx.hideLoading();
        this.setData({ allGranting: false });
        if (!r || !r.ok) {
          wx.showToast({ title: (r && r.msg) || '发放失败', icon: 'none' });
        } else {
          wx.showModal({
            title: '发放完成',
            content: '共处理 ' + r.processed + ' 位用户，成功发放 ' + r.granted + ' 张，' + r.skipped + ' 位用户已达上限跳过。',
            showCancel: false,
          });
          this.loadLogs(true);
        }
      },
    });
  },

  // ========== 发放记录 ==========
  async loadLogs(reset) {
    const skip = reset ? 0 : this.data.logSkip;
    if (reset) this.setData({ logsLoading: true });
    const r = await this.callFn('logs', { skip, limit: LOG_PAGE_SIZE });
    const rows = (r && r.logs) || [];
    const logs = rows.map(x => ({ ...x, fmtTime: this.fmtDate(x.created_at) }));
    this.setData({
      logs: reset ? logs : [...this.data.logs, ...logs],
      logSkip: skip + rows.length,
      hasMoreLogs: !!(r && r.hasMore),
      logsLoading: false,
    });
  },

  loadMoreLogs() { this.loadLogs(false); },

  fmtDate(d) {
    if (!d) return '';
    const dt = new Date(d);
    const M = String(dt.getMonth() + 1).padStart(2, '0');
    const D = String(dt.getDate()).padStart(2, '0');
    const h = String(dt.getHours()).padStart(2, '0');
    const m = String(dt.getMinutes()).padStart(2, '0');
    return M + '-' + D + ' ' + h + ':' + m;
  },
});
