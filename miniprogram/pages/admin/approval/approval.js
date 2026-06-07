// pages/admin/approval/approval.js - 审批加群申请
const dbUtil = require('../../../utils/db');

Page({
  data: {
    requests: [],
    loading: true,
    currentUserId: '',
    showDetail: false,
    detailUser: {},
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
          let avatar = userRes.data.avatarUrl || '';
          if (avatar && avatar.startsWith('cloud://')) {
            try { const u = await wx.cloud.getTempFileURL({ fileList: [avatar] }); avatar = u.fileList[0].tempFileURL; } catch {}
          }
          return {
            ...req,
            userName: userRes.data.nickName || '未知',
            userAvatar: avatar,
            userCity: userRes.data.city,
            groupName: groupRes.data ? groupRes.data.name : '未知群',
            createTime: this.fmt(req.createTime),
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
          // 更新用户的群组（追加）和状态
          await dbUtil.db.collection('users').doc(userId).update({
            data: { groupIds: dbUtil._.addToSet(groupId), status: 'approved' }
          });
          wx.showToast({ title: '已通过', icon: 'success' });
          this.loadRequests();
        } catch (err) {
          wx.showToast({ title: '操作失败', icon: 'none' });
        }
      }
    });
  },

  // 查看用户详情
  async onViewDetail(e) {
    const userId = e.currentTarget.dataset.id;
    const userRes = await dbUtil.db.collection('users').doc(userId).get();
    if (userRes.data) {
      this.setData({ showDetail: true, detailUser: userRes.data });
    }
  },
  onHideDetail() { this.setData({ showDetail: false }); },

  fmt(d) {
    if (!d) return '';
    const dt = new Date(d);
    return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
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
