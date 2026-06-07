// pages/admin/groups/groups.js - 群组管理
const dbUtil = require('../../../utils/db');

Page({
  data: {
    groups: [],
    showAdd: false,
    newGroupName: '',
  },

  async onShow() {
    await this.loadGroups();
  },

  async loadGroups() {
    const res = await dbUtil.getGroups();
    this.setData({ groups: res.data });
  },

  // 显示添加弹窗
  onShowAdd() { this.setData({ showAdd: true, newGroupName: '' }); },
  onHideAdd() { this.setData({ showAdd: false }); },

  onNameInput(e) {
    this.setData({ newGroupName: e.detail.value });
  },

  // 添加群组
  async onAddGroup() {
    const name = this.data.newGroupName.trim();
    if (!name) return wx.showToast({ title: '请输入群名', icon: 'none' });
    try {
      await dbUtil.createGroup({ name, sort: this.data.groups.length + 1 });
      wx.showToast({ title: '添加成功', icon: 'success' });
      this.setData({ showAdd: false });
      this.loadGroups();
    } catch (err) {
      wx.showToast({ title: '添加失败', icon: 'none' });
    }
  },

  // 删除群组
  onDeleteGroup(e) {
    const { id, name } = e.currentTarget.dataset;
    wx.showModal({
      title: '确认删除',
      content: `删除群组"${name}"后，该群下的用户将变为"未加入"状态。确认删除？`,
      confirmColor: '#ff4d4f',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await dbUtil.deleteGroup(id);
          wx.showToast({ title: '已删除', icon: 'success' });
          this.loadGroups();
        } catch (err) {
          wx.showToast({ title: '删除失败', icon: 'none' });
        }
      }
    });
  },
});
