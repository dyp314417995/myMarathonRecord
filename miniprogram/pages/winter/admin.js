// pages/winter/admin.js - 管理组后台（概览/建组/报名审核/成员/抽查/财务/结算/开关）
const w = require('../../utils/winter');

const PHASES = [
  { v: 'closed', t: '未开放' },
  { v: 'trial', t: '报名/试运行' },
  { v: 'formal', t: '正式进行' },
  { v: 'holiday', t: '春节假期（跳过考核）' },
];

Page({
  data: {
    loading: true, tab: 'overview',
    overview: null, cfg: null, counts: {}, groups: [], weekIndex: 0,
    applies: [], members: [], allGroups: [], checkins: [], finance: null,
    // 成员分组查看：memberFilter 为空表示「全部」，此时按组分段展示
    memberFilter: '', memberSections: [], filterChips: [], memberTotal: 0,
    // 组别里的队长/教练指派（成员主记录只有一条，兼任靠 winter_staff）
    groupStaff: [], groupCandidates: [], staffPickIndex: 0, staffPickRole: 'leader',
    phases: PHASES,
    // 弹窗
    showGroup: false, groupForm: { id: '', name: '', desc: '', emblem: '', slogan: '', sloganImage: '', sloganImagePreview: '', capacity: '', sort: '', open: true, autoApprove: false, autoFree: false },
    showTransfer: false, transferForm: { userId: '', newGroupId: '', reason: '', clearFail: true, effectiveDate: '' },
    showRemark: false, remarkForm: { userId: '', remark: '' },
    busy: false,
  },

  async onShow() { await this.load(); },
  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },

  async load() {
    const r = await w.api.adminOverview();
    if (!r.ok) {
      wx.showToast({ title: r.error || '无管理组权限', icon: 'none' });
      this.setData({ loading: false, noPerm: true });
      return;
    }
    this.setData({
      loading: false, noPerm: false,
      overview: r, cfg: r.cfg, counts: r.counts, groups: r.groups, weekIndex: r.weekIndex,
    });
    await this.loadFinance();
  },

  onTab(e) {
    const tab = e.currentTarget.dataset.v;
    this.setData({ tab });
    if (tab === 'applies') this.loadApplies();
    if (tab === 'members') this.loadMembers();
    if (tab === 'checkins') this.loadCheckins();
    if (tab === 'finance') this.loadFinance();
  },

  // 头像加载失败：置空，改用文字头像兜底
  onAvatarError(e) {
    const k = e.currentTarget.dataset.k;
    const i = Number(e.currentTarget.dataset.i);
    if (k === 'applies' && this.data.applies[i]) this.setData({ [`applies[${i}].avatarUrl`]: '' });
    else if (k === 'members' && this.data.members[i]) this.setData({ [`members[${i}].avatarUrl`]: '' });
    else if (k === 'memberSections') {
      // 分组视图里是副本，通过 _idx 回写原始 members 后重建
      const si = Number(e.currentTarget.dataset.si);
      const sec = this.data.memberSections[si];
      const m = sec && sec.members[i];
      if (m && m._idx !== undefined) {
        this.setData({ [`members[${m._idx}].avatarUrl`]: '' }, () => this.buildMemberSections());
      }
    }
  },

  async loadApplies() {
    const r = await w.api.adminApplies({ status: 'pending' });
    if (r.ok) this.setData({ applies: await w.resolveAvatars(r.list || []) });
  },
  async loadMembers() {
    const r = await w.api.adminMembers({});
    if (!r.ok) return;
    const members = await w.resolveAvatars(r.list || []);
    this.setData({ members, allGroups: r.groups || [] }, () => this.buildMemberSections());
  },

  // 按组归类：全部视图按组分段（空组隐藏），选中某组时只看该组
  buildMemberSections() {
    const members = this.data.members || [];
    const gs = this.data.allGroups || [];
    const filter = this.data.memberFilter || '';
    const bucket = {};
    gs.forEach(g => { bucket[g._id] = []; });
    const orphan = [];
    members.forEach((m, i) => {
      // 副本里带 _idx，头像加载失败时能回写原始 members
      const item = Object.assign({ _idx: i }, m);
      const box = m.groupId && bucket[m.groupId];
      (box || orphan).push(item);
    });

    const sections = [];
    gs.forEach(g => {
      if (filter && filter !== g._id) return;
      const arr = bucket[g._id];
      if (!arr.length && filter !== g._id) return;
      sections.push({ gid: g._id, gname: g.name, count: arr.length, members: arr });
    });
    if (!filter && orphan.length) {
      sections.push({ gid: '__orphan', gname: '未分组 / 已退出', count: orphan.length, members: orphan });
    }

    const chips = [{ gid: '', name: '全部', count: members.length }];
    gs.forEach(g => chips.push({ gid: g._id, name: g.name, count: (bucket[g._id] || []).length }));

    this.setData({
      memberSections: sections,
      filterChips: chips,
      memberTotal: filter ? (sections[0] ? sections[0].count : 0) : members.length,
    });
  },

  onMemberFilter(e) {
    const gid = e.currentTarget.dataset.gid || '';
    if (gid === this.data.memberFilter) return;
    this.setData({ memberFilter: gid }, () => this.buildMemberSections());
  },
  async loadCheckins() {
    const r = await w.api.adminCheckins({ status: 'pending' });
    if (r.ok) this.setData({ checkins: r.list });
  },
  async loadFinance() {
    const r = await w.api.adminFinance();
    if (r.ok) this.setData({ finance: r });
  },

  // ===== 组别 =====
  onNewGroup() {
    this.setData({ showGroup: true, groupForm: { id: '', name: '', desc: '', emblem: '', slogan: '', sloganImage: '', sloganImagePreview: '', capacity: '', sort: '', open: true, autoApprove: false } });
  },
  async onEditGroup(e) {
    const g = this.data.groups.find(x => x._id === e.currentTarget.dataset.id);
    if (!g) return;
    // cloud:// 不能直渲，转成 https 临时链接用于预览
    const preview = g.sloganImage ? await w.toTempUrl(g.sloganImage) : '';
    this.setData({
      showGroup: true,
      groupForm: {
        id: g._id, name: g.name, desc: g.desc, emblem: g.emblem,
        slogan: g.slogan || '', sloganImage: g.sloganImage || '', sloganImagePreview: preview,
        capacity: String(g.capacity || ''), sort: String(g.sort || ''), open: g.open,
        autoApprove: !!g.autoApprove,
        autoFree: !!g.autoFree,
      },
    });
    await this.loadGroupStaff(g._id);
  },

  // ===== 组别里的队长/教练指派（支持跨组兼任） =====
  async loadGroupStaff(groupId) {
    const r = await w.api.adminGroupStaff({ groupId });
    if (!r.ok) return;
    this.setData({
      groupStaff: r.staff || [], groupCandidates: r.candidates || [],
      staffPickIndex: 0, staffPickRole: 'leader',
    });
  },
  onStaffPickRole(e) { this.setData({ staffPickRole: e.currentTarget.dataset.role }); },
  onStaffPick(e) { this.setData({ staffPickIndex: Number(e.detail.value) || 0 }); },
  async onAssignStaff() {
    const role = this.data.staffPickRole;
    const c = this.data.groupCandidates[this.data.staffPickIndex];
    if (!c) return wx.showToast({ title: '请选择成员', icon: 'none' });
    wx.showLoading({ title: '处理中' });
    const r = await w.api.adminSetStaff({ groupId: this.data.groupForm.id, userId: c.userId, role });
    wx.hideLoading();
    if (!r.ok) return wx.showToast({ title: r.error || '操作失败', icon: 'none' });
    wx.showToast({ title: '已指派', icon: 'success' });
    await this.loadGroupStaff(this.data.groupForm.id);
    this.load();
  },
  async onRemoveStaff(e) {
    const { uid, role } = e.currentTarget.dataset;
    wx.showLoading({ title: '处理中' });
    const r = await w.api.adminSetStaff({ groupId: this.data.groupForm.id, userId: uid, role, remove: true });
    wx.hideLoading();
    if (!r.ok) return wx.showToast({ title: r.error || '操作失败', icon: 'none' });
    wx.showToast({ title: '已撤销', icon: 'success' });
    await this.loadGroupStaff(this.data.groupForm.id);
    this.load();
  },
  onCloseGroup() { this.setData({ showGroup: false }); },
  onGroupInput(e) {
    const f = e.currentTarget.dataset.f;
    this.setData({ ['groupForm.' + f]: e.detail.value });
  },
  onGroupOpen(e) { this.setData({ 'groupForm.open': e.detail.value }); },
  onGroupAutoApprove(e) { this.setData({ 'groupForm.autoApprove': e.detail.value }); },
  onGroupAutoFree(e) { this.setData({ 'groupForm.autoFree': e.detail.value }); },

  // 队伍照片：上传到云存储，拿到 fileID 后再换 https 链接预览
  async onChooseGroupPhoto() {
    wx.chooseMedia({
      count: 1, mediaType: ['image'], sourceType: ['album', 'camera'],
      success: async (res) => {
        const f = res.tempFiles && res.tempFiles[0];
        if (!f) return;
        wx.showLoading({ title: '上传中' });
        try {
          const fileID = await w.uploadCheckinImage(f.tempFilePath);
          const preview = await w.toTempUrl(fileID);
          this.setData({ 'groupForm.sloganImage': fileID, 'groupForm.sloganImagePreview': preview });
        } catch (err) {
          wx.showToast({ title: '上传失败，请重试', icon: 'none' });
        }
        wx.hideLoading();
      },
    });
  },
  onRemoveGroupPhoto() {
    this.setData({ 'groupForm.sloganImage': '', 'groupForm.sloganImagePreview': '' });
  },
  onPreviewGroupPhoto() {
    const url = this.data.groupForm.sloganImagePreview;
    if (url) wx.previewImage({ urls: [url] });
  },

  async onSaveGroup() {
    const f = this.data.groupForm;
    if (!String(f.name || '').trim()) return wx.showToast({ title: '请填写组名', icon: 'none' });
    this.setData({ busy: true });
    const r = await w.api.adminSaveGroup({
      id: f.id, name: f.name, desc: f.desc, emblem: f.emblem,
      slogan: f.slogan || '', sloganImage: f.sloganImage || '',
      capacity: Number(f.capacity) || 0, sort: Number(f.sort) || 0, open: f.open,
      autoApprove: !!f.autoApprove,
      autoFree: !!f.autoFree,
    });
    this.setData({ busy: false });
    if (!r.ok) return wx.showToast({ title: r.error || '保存失败', icon: 'none' });
    wx.showToast({ title: '已保存', icon: 'success' });
    this.setData({ showGroup: false });
    this.load();
  },

  // ===== 报名审核 =====
  onReviewApply(e) {
    const { id, pass } = e.currentTarget.dataset;
    const apply = this.data.applies.find(a => a._id === id);
    wx.showModal({
      title: pass ? '确认通过并任命？' : '确认驳回？',
      content: `${apply ? apply.nickName : ''} 申请担任 ${apply ? apply.roleText : ''}（${apply ? apply.groupName : ''}）`,
      success: async (res) => {
        if (!res.confirm) return;
        const r = await w.api.adminReviewApply({ userId: id, pass: pass === true || pass === 'true', groupId: '' });
        if (!r.ok) return wx.showToast({ title: r.error || '操作失败', icon: 'none' });
        wx.showToast({ title: '已处理', icon: 'success' });
        this.loadApplies(); this.load();
      },
    });
  },

  // ===== 成员 / 调组 / 备注 / 退出 =====
  onOpenTransfer(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({
      showTransfer: true,
      transferForm: { userId: id, newGroupId: '', reason: '', clearFail: false, effectiveDate: '' }, // 规则：转组连续未完成不清零
    });
  },
  onCloseTransfer() { this.setData({ showTransfer: false }); },
  onTransferInput(e) {
    const f = e.currentTarget.dataset.f;
    this.setData({ ['transferForm.' + f]: e.detail.value });
  },
  onTransferClear(e) { this.setData({ 'transferForm.clearFail': e.detail.value }); },
  onPickTransferGroup(e) { this.setData({ 'transferForm.newGroupId': e.currentTarget.dataset.id }); },
  async onSaveTransfer() {
    const f = this.data.transferForm;
    if (!f.newGroupId) return wx.showToast({ title: '请选择目标组别', icon: 'none' });
    if (!String(f.reason || '').trim()) return wx.showToast({ title: '请填写调整原因', icon: 'none' });
    this.setData({ busy: true });
    const r = await w.api.adminTransfer({
      userId: f.userId, newGroupId: f.newGroupId, reason: f.reason,
      clearFail: f.clearFail, effectiveDate: f.effectiveDate,
    });
    this.setData({ busy: false });
    if (!r.ok) return wx.showToast({ title: r.error || '操作失败', icon: 'none' });
    wx.showToast({ title: '已调组并留痕', icon: 'success' });
    this.setData({ showTransfer: false });
    this.loadMembers();
  },

  onOpenRemark(e) {
    const id = e.currentTarget.dataset.id;
    const m = this.data.members.find(x => x._id === id);
    this.setData({ showRemark: true, remarkForm: { userId: id, remark: m ? m.remark : '' } });
  },
  onCloseRemark() { this.setData({ showRemark: false }); },
  onRemarkInput(e) { this.setData({ 'remarkForm.remark': e.detail.value }); },
  async onSaveRemark() {
    const f = this.data.remarkForm;
    const r = await w.api.adminRemark({ userId: f.userId, remark: f.remark });
    if (!r.ok) return wx.showToast({ title: r.error || '保存失败', icon: 'none' });
    wx.showToast({ title: '已备注', icon: 'success' });
    this.setData({ showRemark: false });
    this.loadMembers();
  },

  async onToggleFee(e) {
    const id = e.currentTarget.dataset.id;
    const m = this.data.members.find(x => x._id === id);
    // 三态循环：未缴费 → 已缴费 → 免费 → 未缴费
    const fee = (m && m.feeStatus) || 'unpaid';
    const next = fee === 'paid' ? 'free' : (fee === 'free' ? 'unpaid' : 'paid');
    const r = await w.api.adminUpdateFinance({ userId: id, feeStatus: next });
    if (!r.ok) return wx.showToast({ title: r.error || '更新失败', icon: 'none' });
    const txt = next === 'paid' ? '已缴费' : (next === 'free' ? '免费（无需缴费）' : '未缴费');
    wx.showToast({ title: '已标记：' + txt, icon: 'success' });
    this.loadMembers(); this.loadFinance();
  },

  onConfirmQuit(e) {
    const { id, confirm } = e.currentTarget.dataset;
    wx.showModal({
      title: confirm ? '确认退出冬训营？' : '撤销退出建议？',
      content: confirm ? '确认后该成员将退出冬训营' : '将清除连续未完成计数并恢复正常状态',
      success: async (res) => {
        if (!res.confirm) return;
        const r = await w.api.adminConfirmQuit({ userId: id, confirm: confirm === true || confirm === 'true' });
        if (!r.ok) return wx.showToast({ title: r.error || '操作失败', icon: 'none' });
        wx.showToast({ title: '已处理', icon: 'success' });
        this.loadMembers();
      },
    });
  },

  // ===== 抽查审核 =====
  async onAdminReviewCheckin(e) {
    const { id, pass } = e.currentTarget.dataset;
    const r = await w.api.reviewCheckin({ id, pass: pass === true || pass === 'true', note: pass ? '' : '管理组抽查驳回' });
    if (!r.ok) return wx.showToast({ title: r.error || '操作失败', icon: 'none' });
    wx.showToast({ title: pass ? '已通过' : '已驳回', icon: 'success' });
    this.loadCheckins();
  },

  // ===== 罚金状态 =====
  async onToggleFine(e) {
    const { id, status } = e.currentTarget.dataset;
    const r = await w.api.adminUpdateFinance({ fineId: id, status });
    if (!r.ok) return wx.showToast({ title: r.error || '更新失败', icon: 'none' });
    wx.showToast({ title: '已更新', icon: 'success' });
    this.loadFinance();
  },

  // ===== 阶段开关 =====
  onSetPhase(e) {
    const v = e.currentTarget.dataset.v;
    const text = (this.data.phases.find(p => p.v === v) || {}).t || v;
    const tipMap = {
      holiday: '切换到春节假期：打卡照常开放，仅跳过考核——不计 KPI、不计连续、不发红包、不参与榜单（2/5—2/11 放假，对应第 12、13 周）',
      formal: '正式进行期间正常计 KPI、连续未完成与罚金（注意：第 1 周为警告周，只提醒不罚）',
      trial: '报名/试运行：不罚款、不计连续、不结算榜单，可免费调组换角色',
    };
    const tip = tipMap[v] || '确认切换运营阶段';
    wx.showModal({
      title: '切换为「' + text + '」？',
      content: tip || '确认切换运营阶段',
      success: async (res) => {
        if (!res.confirm) return;
        const r = await w.api.adminSetPhase({ phase: v });
        if (!r.ok) return wx.showToast({ title: r.error || '切换失败', icon: 'none' });
        wx.showToast({ title: '已切换', icon: 'success' });
        this.load();
      },
    });
  },

  onToggleSignup() {
    const next = !this.data.cfg.signupOpen;
    wx.showModal({
      title: next ? '开放报名？' : '关闭报名？',
      content: next ? '开放后新用户可提交报名' : '关闭后新用户无法提交报名',
      success: async (res) => {
        if (!res.confirm) return;
        const r = await w.api.adminSetPhase({ phase: this.data.cfg.phase, signupOpen: next });
        if (!r.ok) return wx.showToast({ title: r.error || '操作失败', icon: 'none' });
        wx.showToast({ title: '已更新', icon: 'success' });
        this.load();
      },
    });
  },

  // ===== 周结算 =====
  onCalcWeek() {
    wx.showModal({
      title: '结算本周？',
      content: `对第 ${this.data.weekIndex} 周进行结算：统计完成率、更新连续未完成周数并生成罚金记录`,
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '结算中' });
        const r = await w.api.adminCalcWeek({});
        wx.hideLoading();
        if (!r.ok) return wx.showToast({ title: r.error || '结算失败', icon: 'none' });
        wx.showModal({
          title: '结算完成',
          content: `完成 ${r.done} 人 · 未完成 ${r.failed} 人 · 罚金合计 ${r.fineTotal} 元${r.frozen ? '（本周跳过考核：不计连续、不发红包、不参与榜单，打卡记录保留）' : ''}`,
          showCancel: false,
        });
        this.load();
      },
    });
  },
});
