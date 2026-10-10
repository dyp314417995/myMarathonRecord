// pages/super-admin/manage.js - 超管：配置管理员（v2.7 支持多选省份）
const dbUtil = require('../../utils/db');
const cityData = require('../../utils/city-data');

// 取全国省份列表（直接从 city-data 顶层抽取）
const ALL_PROVINCES = cityData.map(p => p.name);

// 权限名称映射（WXML 无法调用页面方法，必须预计算）
const PERM_NAME_MAP = { approve_points: '积分审批', remove_user: '移除用户' };

Page({
  data: {
    admins: [],
    users: [],
    loading: true,
    showAdd: false,
    editingAdminId: '',     // 非空 = 编辑模式（复用添加弹窗）
    // 新增/编辑管理员表单
    selectedUserId: '',
    selectedUserName: '',
    validFrom: '',
    validTo: '',
    permissions: {
      approve_points: true,
      remove_user: true,
    },
    // 省份相关
    allProvinces: ALL_PROVINCES,
    selectedProvinces: [],   // 已选中的省份
    provincePickerVisible: false, // 多选弹窗
    provinceSearchKey: '',        // 省份搜索关键字
    provinceFilterShown: [],      // 多选弹窗过滤后展示 [{ name, checked }]（WXML 不支持 indexOf，需预计算 checked）
    showProvinceTagPicker: false, // 列表点击展示省份角标时使用
  },

  async onShow() {
    await Promise.all([this.loadAdmins(), this.loadUsers()]);
  },

  // 加载管理员列表
  async loadAdmins() {
    const res = await dbUtil.getAdminList();
    // 批量转换云头像
    const allUsers = await Promise.all(res.data.map(a => dbUtil.db.collection('users').doc(a.userId).get().then(r => r.data).catch(() => null)));
    const cloudIds = allUsers.filter(u => u && u.avatarUrl && u.avatarUrl.startsWith('cloud://')).map(u => u.avatarUrl);
    let urlMap = {};
    if (cloudIds.length) {
      try {
        const r = await wx.cloud.callFunction({ name: 'getImageUrls', data: { fileIDs: cloudIds } });
        (r.result || []).forEach(f => { if (f.tempFileURL) urlMap[f.fileID] = f.tempFileURL; });
      } catch {}
    }
    const enriched = res.data.map((admin, i) => {
      const u = allUsers[i];
      if (!u) return null;
      // 已撤销的管理员不在列表中显示
      if (admin.status === 'revoked') return null;
      let avatar = u.avatarUrl || '';
      if (avatar.startsWith('cloud://')) avatar = urlMap[avatar] || '';
      const provinces = Array.isArray(admin.provinces) ? admin.provinces : [];
      return {
        ...admin,
        userName: u.nickName || '未知',
        userAvatar: avatar,
        isExpired: new Date(admin.validTo) < new Date(),
        validFrom: this.formatDate(new Date(admin.validFrom)),
        validTo: this.formatDate(new Date(admin.validTo)),
        provinces,
        provinceText: provinces.length ? provinces.join('、') : '全国',
        permNames: (admin.permissions || []).map(p => PERM_NAME_MAP[p] || p),
      };
    }).filter(Boolean);
    // 同一用户只保留最新记录
    const seen = {};
    const deduped = enriched.filter(Boolean).filter(a => {
      if (seen[a.userId]) return false;
      seen[a.userId] = true;
      return true;
    });
    this.setData({ admins: deduped, loading: false });
  },

  // 加载普通用户列表（用于选择）
  async loadUsers() {
    const res = await dbUtil.getUserList({ role: 'user' }, 0, 20);
    this.setData({ users: res.data });
  },

  onSearchAdminUser(e) {
    const kw = e.detail.value || '';
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

  // 显示添加弹窗
  onShowAdd() {
    const today = this.formatDate(new Date());
    const nextYear = this.formatDate(new Date(Date.now() + 36500 * 24 * 60 * 60 * 1000));
    this.setData({
      showAdd: true, editingAdminId: '', selectedUserId: '', selectedUserName: '',
      validFrom: today, validTo: nextYear,
      permissions: { approve_points: true, remove_user: true },
      selectedProvinces: [], provinceSearchKey: '', provinceFilterShown: this.filterProvinces('', []),
    });
  },

  // 点击"编辑"：复用弹窗回填该管理员的现有配置
  onEditAdmin(e) {
    const { id } = e.currentTarget.dataset;
    const admin = this.data.admins.find(a => a._id === id);
    if (!admin) return;
    this.setData({
      showAdd: true,
      editingAdminId: id,
      selectedUserId: admin.userId,
      selectedUserName: admin.userName,
      validFrom: admin.validFrom,   // formatDate 输出即 YYYY-MM-DD，可直接用于 date input
      validTo: admin.validTo,
      permissions: {
        approve_points: (admin.permissions || []).includes('approve_points'),
        remove_user: (admin.permissions || []).includes('remove_user'),
      },
      selectedProvinces: [...(admin.provinces || [])],
      provinceSearchKey: '',
      provinceFilterShown: this.filterProvinces('', admin.provinces || []),
    });
  },

  onHideAdd() { this.setData({ showAdd: false, editingAdminId: '' }); },

  // 选择用户
  onSelectUser(e) {
    const { id, name } = e.currentTarget.dataset;
    this.setData({ selectedUserId: id, selectedUserName: name });
  },

  onDateInput(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [field]: e.detail.value });
  },

  onTogglePermission(e) {
    const { key } = e.currentTarget.dataset;
    this.setData({ [`permissions.${key}`]: !this.data.permissions[key] });
  },

  // 省份多选
  onShowProvincePicker() {
    this.setData({
      provincePickerVisible: true,
      provinceSearchKey: '',
      provinceFilterShown: this.filterProvinces('', this.data.selectedProvinces),
    });
  },
  onHideProvincePicker() { this.setData({ provincePickerVisible: false }); },
  onProvinceSearch(e) {
    const kw = e.detail.value || '';
    this.setData({ provinceSearchKey: kw, provinceFilterShown: this.filterProvinces(kw, this.data.selectedProvinces) });
  },
  // 返回 [{ name, checked }]，checked 预计算（WXML 表达式不支持数组 indexOf）
  filterProvinces(kw, selected) {
    const k = kw.trim().toLowerCase();
    return ALL_PROVINCES
      .filter(p => !k || p.toLowerCase().includes(k))
      .map(p => ({ name: p, checked: selected.includes(p) }));
  },
  refreshProvinceFilter() {
    this.setData({ provinceFilterShown: this.filterProvinces(this.data.provinceSearchKey, this.data.selectedProvinces) });
  },
  onToggleProvince(e) {
    const { name } = e.currentTarget.dataset;
    const list = [...this.data.selectedProvinces];
    const idx = list.indexOf(name);
    if (idx >= 0) list.splice(idx, 1); else list.push(name);
    this.setData({ selectedProvinces: list });
    this.refreshProvinceFilter();
  },
  onClearProvinces() { this.setData({ selectedProvinces: [] }); this.refreshProvinceFilter(); },
  onPickAllProvinces() { this.setData({ selectedProvinces: [...this.data.allProvinces] }); this.refreshProvinceFilter(); },

  // 添加/编辑管理员（editingAdminId 非空时为编辑，直接更新原记录，不撤销重建）
  async onAddAdmin() {
    const { editingAdminId, selectedUserId, validFrom, validTo, permissions, selectedProvinces } = this.data;
    if (!selectedUserId) return wx.showToast({ title: '请选择用户', icon: 'none' });
    if (!validFrom || !validTo) return wx.showToast({ title: '请设置有效期', icon: 'none' });
    if (new Date(validTo) <= new Date(validFrom)) return wx.showToast({ title: '结束日期必须大于开始日期', icon: 'none' });

    const permList = [];
    if (permissions.approve_points) permList.push('approve_points');
    if (permissions.remove_user) permList.push('remove_user');
    if (permList.length === 0) return wx.showToast({ title: '请至少选择一个权限', icon: 'none' });

    try {
      const data = {
        validFrom: new Date(validFrom),
        validTo: new Date(validTo),
        permissions: permList,
        provinces: selectedProvinces, // 多选省份（空数组=全国）
        status: 'active',
      };
      if (editingAdminId) {
        // 编辑：原位更新，保留 createTime/首次设置时间
        await dbUtil.updateAdmin(editingAdminId, data);
        wx.showToast({ title: '已保存', icon: 'success' });
      } else {
        // 新增：先撤销该用户已有的管理员记录
        await dbUtil.db.collection('admins').where({ userId: selectedUserId }).update({ data: { status: 'revoked' } });
        await dbUtil.createAdmin({
          userId: selectedUserId,
          ...data,
        });
        // 更新用户角色（超管不降级：超管本身已兼容全部管理员权限）
        const uRes = await dbUtil.db.collection('users').doc(selectedUserId).get().catch(() => null);
        if (!uRes || !uRes.data || uRes.data.role !== 'super_admin') {
          await dbUtil.updateUser(selectedUserId, { role: 'admin' });
        }
        wx.showToast({ title: '添加成功', icon: 'success' });
      }
      this.setData({ showAdd: false, editingAdminId: '' });
      this.loadAdmins();
    } catch (err) {
      console.error('save admin error:', err);
      wx.showToast({ title: editingAdminId ? '保存失败' : '添加失败', icon: 'none' });
    }
  },

  // 撤销管理员
  onRevokeAdmin(e) {
    const { id, userId } = e.currentTarget.dataset;
    wx.showModal({
      title: '确认撤销',
      content: '确认撤销该用户的管理员权限？',
      confirmColor: '#ff4d4f',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await dbUtil.updateAdmin(id, { status: 'revoked' });
          // 超管不降级：撤销的只是 admins 配置记录，不覆盖超管角色
          const uRes = await dbUtil.db.collection('users').doc(userId).get().catch(() => null);
          if (!uRes || !uRes.data || uRes.data.role !== 'super_admin') {
            await dbUtil.updateUser(userId, { role: 'user' });
          }
          wx.showToast({ title: '已撤销', icon: 'success' });
          this.loadAdmins();
        } catch (err) {
          wx.showToast({ title: '操作失败', icon: 'none' });
        }
      }
    });
  },

  formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  },
});
