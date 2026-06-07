// pages/admin/approval/approval.js - 审批加群申请
const dbUtil = require('../../../utils/db');

Page({
  data: {
    requests: [],
    loading: true,
    currentUserId: '',
  },

  async onShow() {
    const userInfo = wx.getStorageSync('userInfo');
    this.setData({ currentUserId: userInfo._id });
    await this.loadRequests();
  },

  async loadRequests() {
    this.setData({ loading: true });
    try {
      const res = await dbUtil.getPendingRequests();
      // 关联查询用户信息和群组信息
      const enriched = await Promise.all(res.data.map(async (req) => {
        try {
          const [userRes, groupRes] = await Promise.all([
            dbUtil.db.collection('users').doc(req.userId).get(),
            dbUtil.db.collection('groups').doc(req.groupId).get(),
          ]);
          return {
            ...req,
            userName: userRes.data.realName || userRes.data.nickName || '未知',
            userAvatar: userRes.data.avatarUrl,
            userCity: userRes.data.city,
            groupName: groupRes.data ? groupRes.data.name : '未知群',
          };
        } catch { return req; }
      }));
      this.setData({ requests: enriched, loading: false });
    } catch (err) {
      console.error('加载审批列表失败:', err);
      this.setData({ loading: false });
    }
  },

  // 审批通过
  async onApprove(e) {
    const { id, userId, groupId } = e.currentTarget.dataset;
    wx.showModal({
      title: '确认通过',
      content: '确认通过该用户的加群申请？',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          // 更新申请状态
          await dbUtil.reviewRequest(id, 'approved', this.data.currentUserId);
          // 更新用户的群组和状态
          await dbUtil.updateUser(userId, { groupId, status: 'approved' });
          wx.showToast({ title: '已通过', icon: 'success' });
          this.loadRequests();
        } catch (err) {
          wx.showToast({ title: '操作失败', icon: 'none' });
        }
      }
    });
  },

  // 审批拒绝
  async onReject(e) {
    const { id, userId } = e.currentTarget.dataset;
    wx.showModal({
      title: '确认拒绝',
      content: '确认拒绝该用户的加群申请？',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await dbUtil.reviewRequest(id, 'rejected', this.data.currentUserId);
          await dbUtil.updateUser(userId, { status: 'rejected' });
          wx.showToast({ title: '已拒绝', icon: 'success' });
          this.loadRequests();
        } catch (err) {
          wx.showToast({ title: '操作失败', icon: 'none' });
        }
      }
    });
  },
});
