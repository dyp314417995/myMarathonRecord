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

  async onLoad() {
    const userInfo = wx.getStorageSync('userInfo') || {};
    if (userInfo.nickName || userInfo.nickname) {
      this.setData({ nickName: userInfo.nickName || userInfo.nickname });
    }
    await this.loadGroups();
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

  onPickGroup(e) {
    const id = e.currentTarget.dataset.id;
    const g = this.data.groups.find(x => x._id === id);
    if (!g || g.open === false) return;
    // 没有队长的组暂不能加入队员/教练（队长需先由管理组任命）
    if (!(g.leaders && g.leaders.length) && this.data.role !== 'leader') {
      wx.showToast({ title: '该组暂无队长，需先申请队长并通过任命', icon: 'none' });
    }
    if (g.capacity && g.memberCount >= g.capacity && !this.data.acceptAdjust) {
      wx.showToast({ title: '该组已满，可勾选接受调剂', icon: 'none' });
    }
    this.setData({ groupId: id, groupName: g.name });
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
    // 全部走审核：队长由管理组任命；队员/教练由本组队长审批（须线下缴费后通过）
    const reviewer = r.reviewer === 'admin' ? '管理组审核任命' : '本组队长审核';
    const tip = r.reviewer === 'admin'
      ? `你的队长申请已提交，等待${reviewer}`
      : `你的入队申请已提交，等待${reviewer}；队长确认线下缴费后即可通过`;
    wx.showModal({
      title: '提交成功',
      content: tip,
      showCancel: false,
      success: () => wx.navigateBack(),
    });
  },
});
