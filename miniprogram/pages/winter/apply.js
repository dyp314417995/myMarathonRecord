// pages/winter/apply.js - 冬训练报名
const w = require('../../utils/winter');

const ROLES = [
  { v: 'member', t: '队员', desc: '在教练设定的区间内填报 KPI，每日打卡' },
  { v: 'leader', t: '队长', desc: '审核本组打卡、周统计、催打卡（需管理组任命）' },
  { v: 'coach', t: '教练', desc: '设定 KPI 区间、发布周课表、训练建议（需管理组任命）' },
];

Page({
  data: {
    loading: true, submitting: false,
    groups: [], groupId: '', groupName: '',
    roles: ROLES, role: 'member',
    nickName: '', recentResult: '', target: '', reason: '',
    acceptAdjust: false,
    roleDesc: ROLES[0].desc,
  },

  async onLoad(options) {
    const userInfo = wx.getStorageSync('userInfo') || {};
    if (userInfo.nickName || userInfo.nickname) {
      this.setData({ nickName: userInfo.nickName || userInfo.nickname });
    }
    await this.loadGroups();
    // 从分享邀请进来：自动选中被邀请的那个组
    const gid = options && (options.gid || options.groupId);
    if (gid) {
      const g = this.data.groups.find(x => x._id === gid);
      if (g && g.open !== false) {
        this.applyGroup(g);
        const hasLeader = !!(g.leaders && g.leaders.length);
        if (!hasLeader) this.askTakeLeader(g);
      }
    }
  },

  async loadGroups() {
    const r = await w.api.intro();
    if (!r.ok) {
      wx.showToast({ title: r.error || '加载失败', icon: 'none' });
      this.setData({ loading: false });
      return;
    }
    const groups = (r.groups || []).filter(g => g.open);
    this.setData({ loading: false, groups });
  },

  // 选中某个组
  applyGroup(g) {
    this.setData({ groupId: g._id, groupName: g.name });
  },

  // 该组没有队长：建议第一个加入的人暂代队长
  askTakeLeader(g) {
    wx.showModal({
      title: '暂无队长',
      content: '该组还没有队长，你是第一个，暂代队长吧！\n队长经管理组任命后，即可在本组审批入队申请、查看本组打卡。\n（不同意则返回，可换个组看看）',
      confirmText: '暂代队长',
      cancelText: '不同意',
      success: (res) => {
        if (!res.confirm) {
          // 不同意则返回：清除已选组，留在选择界面
          this.setData({ groupId: '', groupName: '' });
          return;
        }
        this.setData({
          groupId: g._id, groupName: g.name,
          role: 'leader', roleDesc: ROLES[1].desc,
        });
      },
    });
  },

  onPickGroup(e) {
    const id = e.currentTarget.dataset.id;
    const g = this.data.groups.find(x => x._id === id);
    if (!g || g.open === false) return;
    if (g.capacity && g.memberCount >= g.capacity && !this.data.acceptAdjust) {
      wx.showToast({ title: '该组已满，可勾选接受调剂', icon: 'none' });
    }
    // 没有队长的组也开放加入，但要先提醒对方是否暂代队长
    const hasLeader = !!(g.leaders && g.leaders.length);
    if (!hasLeader && this.data.role !== 'leader') {
      this.askTakeLeader(g);
      return;
    }
    this.applyGroup(g);
  },

  onPickRole(e) {
    const v = e.currentTarget.dataset.v;
    const role = this.data.roles.find(x => x.v === v);
    this.setData({ role: v, roleDesc: role ? role.desc : '' });
  },

  onToggleAdjust() { this.setData({ acceptAdjust: !this.data.acceptAdjust }); },

  // 申请理由框在页面下部，聚焦时滚到可视区，避免被输入法挡住
  onReasonFocus() {
    setTimeout(() => {
      wx.pageScrollTo({ scrollTop: 99999, duration: 200 });
    }, 200);
  },
  onInput(e) {
    const f = e.currentTarget.dataset.f;
    this.setData({ [f]: e.detail.value });
  },

  async onSubmit() {
    const d = this.data;
    if (!d.nickName.trim()) return wx.showToast({ title: '请填写昵称', icon: 'none' });
    if (!d.groupId) return wx.showToast({ title: '请选择组别', icon: 'none' });
    if (d.role !== 'member' && !d.reason.trim()) {
      return wx.showToast({ title: '申请队长/教练需填写申请理由', icon: 'none' });
    }
    this.setData({ submitting: true });
    const r = await w.api.submitApply({
      nickName: d.nickName, recentResult: d.recentResult, target: d.target,
      groupId: d.groupId, role: d.role, reason: d.reason, acceptAdjust: d.acceptAdjust,
    });
    this.setData({ submitting: false });
    if (!r.ok) return wx.showToast({ title: r.error || '提交失败', icon: 'none' });
    // 全部走审核：队长（含无队长组的首位加入者）由管理组任命；其余由本组队长审批
    const reviewer = r.reviewer === 'admin' ? '管理组审核任命' : '本组队长审核';
    const tip = d.role === 'leader'
      ? `你的队长申请已提交，等待${reviewer}`
      : `你的入队申请已提交，等待${reviewer}`;
    wx.showModal({
      title: '提交成功',
      content: tip,
      showCancel: false,
      success: () => wx.navigateBack(),
    });
  },
});
