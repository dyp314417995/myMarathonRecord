// pages/admin/raceSignup/raceSignup.js - 自办赛报名名单（管理员）
// 线下：勾「已收款」；线上：看名单 + 代退赛；入口：赛事管理 → 报名名单
Page({
  data: {
    loading: true, eventId: '', eventName: '', eventMode: 'offline',
    list: [], active: 0, capacity: 0,
    // 代报名
    showAdd: false, addForm: { keyword: '', candidates: [], userIdx: 0, groupIdx: 0 },
    saving: false,
  },

  async onLoad(options) {
    this.setData({ eventId: options.eventId || '', eventName: decodeURIComponent(options.name || '') });
    this.load();
  },

  async load() {
    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo || !userInfo._id) return wx.navigateTo({ url: '/pages/login/login' });
    const r = await wx.cloud.callFunction({
      name: 'raceEvent',
      data: { action: 'listSignups', userId: userInfo._id, eventId: this.data.eventId },
    }).catch(() => null);
    const res = (r && r.result) || {};
    if (!res.ok) {
      wx.showToast({ title: res.error || '加载失败', icon: 'none' });
      this.setData({ loading: false });
      return;
    }
    this.setData({
      loading: false,
      list: (res.list || []).map(x => ({
        ...x,
        statusText: { registered: '已报名', finished: '已完赛', quit: '已退赛', dns: '弃赛' }[x.status] || x.status,
      })),
      active: res.active || 0,
      capacity: res.capacity || 0,
      eventMode: (res.event && res.event.mode) || 'offline',
    });
  },

  async onTogglePaid(e) {
    const { id, paid } = e.currentTarget.dataset;
    const userInfo = wx.getStorageSync('userInfo');
    const r = await wx.cloud.callFunction({
      name: 'raceEvent',
      data: { action: 'markPaid', userId: userInfo._id, markerId: id, paid: paid !== true },
    }).catch(() => ({ result: { ok: false } }));
    const res = (r && r.result) || {};
    if (!res.ok) return wx.showToast({ title: res.error || '操作失败', icon: 'none' });
    this.load();
  },

  onTapQuit(e) {
    const uid = e.currentTarget.dataset.uid;
    const userInfo = wx.getStorageSync('userInfo');
    wx.showModal({ title: '代退赛', content: '将释放该成员的报名名额，确定？', confirmColor: '#ff4d4f', success: async (res) => {
      if (!res.confirm) return;
      const r = await wx.cloud.callFunction({
        name: 'raceEvent',
        data: { action: 'quit', userId: userInfo._id, byAdmin: true, targetUserId: uid, eventId: this.data.eventId },
      }).catch(() => ({ result: { ok: false } }));
      const out = (r && r.result) || {};
      if (!out.ok) return wx.showToast({ title: out.error || '操作失败', icon: 'none' });
      wx.showToast({ title: '已退赛', icon: 'success' });
      this.load();
    }});
  },

  // ---------- 代报名（报名截止后管理员补录） ----------
  onOpenAdd() { this.setData({ showAdd: true, addForm: { keyword: '', candidates: [], userIdx: 0, groupIdx: 0 } }); },
  onHideAdd() { this.setData({ showAdd: false }); },
  async onSearchUser(e) {
    const kw = (e.detail.value || '').trim();
    this.setData({ 'addForm.keyword': kw });
    if (kw.length < 2) return this.setData({ 'addForm.candidates': [] });
    // 客户端直查 users（管理端已有权限的模式，与 admin/users 一致）
    const db = wx.cloud.database();
    const r = await db.collection('users').where({
      nickName: db.RegExp({ regexp: kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options: 'i' }),
    }).limit(10).get().catch(() => null);
    this.setData({ 'addForm.candidates': ((r && r.data) || []).map(u => ({ _id: u._id, nickName: u.nickName || u.nickname || '未知' })) });
  },
  onPickUser(e) { this.setData({ 'addForm.userIdx': Number(e.detail.value) || 0 }); },
  onPickGroup(e) { this.setData({ 'addForm.groupIdx': Number(e.detail.value) || 0 }); },

  async onConfirmAdd() {
    if (this.data.saving) return;
    const f = this.data.addForm;
    const u = f.candidates[f.userIdx];
    if (!u) return wx.showToast({ title: '请先搜索并选择成员', icon: 'none' });
    const userInfo = wx.getStorageSync('userInfo');
    this.setData({ saving: true });
    wx.showLoading({ title: '报名中' });
    const r = await wx.cloud.callFunction({
      name: 'raceEvent',
      data: { action: 'signup', userId: userInfo._id, byAdmin: true, targetUserId: u._id, eventId: this.data.eventId, noticeAgreed: true },
    }).catch(e => ({ result: { ok: false, error: e.message } }));
    wx.hideLoading();
    this.setData({ saving: false });
    const res = (r && r.result) || {};
    if (!res.ok) return wx.showToast({ title: res.error || '代报名失败', icon: 'none' });
    wx.showToast({ title: '已代报名', icon: 'success' });
    this.setData({ showAdd: false });
    this.load();
  },
});
