// pages/admin/groups/groups.js - 群组管理（编辑/排序/二维码）
const dbUtil = require('../../../utils/db');

Page({
  data: {
    groups: [],
    showModal: false,
    modalTitle: '',
    editId: '',           // 编辑模式下存 group._id
    groupName: '',
    groupDesc: '',
    groupRemark: '',
    qrCode: '',           // 已有二维码 cloud fileID
    qrCodeTemp: '',       // 新选的临时路径
    qrCodeNew: '',        // 新上传后的 cloud fileID（确认时合并）
  },

  async onShow() {
    await this.loadGroups();
  },

  async loadGroups() {
    const res = await dbUtil.getGroups();
    // 显示二维码缩略图用的临时链接
    const enriched = await Promise.all(res.data.map(async (g) => {
      if (g.qrCode) {
        try {
          const urlRes = await wx.cloud.getTempFileURL({ fileList: [g.qrCode] });
          return { ...g, qrCodeUrl: urlRes.fileList[0].tempFileURL };
        } catch { return g; }
      }
      return g;
    }));
    this.setData({ groups: enriched });
  },

  // ========== 添加 ==========
  onShowAdd() {
    this.setData({ showModal: true, modalTitle: '添加新群组', editId: '', groupName: '', groupDesc: '', groupRemark: '', qrCode: '', qrCodeTemp: '', qrCodeNew: '' });
  },

  onEdit(e) {
    const { id, name, qr } = e.currentTarget.dataset;
    this.setData({ showModal: true, modalTitle: '编辑群组', editId: id, groupName: name, qrCode: qr || '', qrCodeTemp: '', qrCodeNew: '' });
  },

  // ========== 弹窗关闭 ==========
  onHideModal() { this.setData({ showModal: false }); },

  onNameInput(e) { this.setData({ groupName: e.detail.value }); },

  // ========== 上传二维码 ==========
  onChooseQRCode() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const tempPath = res.tempFiles[0].tempFilePath;
        this.setData({ qrCodeTemp: tempPath });
      }
    });
  },

  // ========== 清除二维码 ==========
  onClearQR() { this.setData({ qrCode: '', qrCodeTemp: '', qrCodeNew: '__clear__' }); },

  // ========== 确认提交 ==========
  async onSubmit() {
    const { editId, groupName, groupDesc, groupRemark, qrCodeTemp, qrCodeNew, qrCode } = this.data;
    const name = groupName.trim();
    if (!name) return wx.showToast({ title: '请输入群名', icon: 'none' });

    wx.showLoading({ title: '保存中...' });
    try {
      let finalQR = qrCodeNew === '__clear__' ? '' : qrCode;

      // 如果选了新图片，上传到云存储
      if (qrCodeTemp) {
        const uploadRes = await wx.cloud.uploadFile({
          cloudPath: `group-qr/${Date.now()}-${Math.random().toString(36).slice(2)}.png`,
          filePath: qrCodeTemp,
        });
        finalQR = uploadRes.fileID;
      }

      const data = { name, description: groupDesc.trim(), remark: groupRemark.trim() || '群已满，请联系管理员邀请加入', qrCode: finalQR };
      if (editId) {
        // 编辑模式
        await dbUtil.updateGroup(editId, data);
      } else {
        // 新增模式
        data.sort = this.data.groups.length + 1;
        await dbUtil.createGroup(data);
      }

      wx.hideLoading();
      wx.showToast({ title: '保存成功', icon: 'success' });
      this.setData({ showModal: false });
      this.loadGroups();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  // ========== 排序 ==========
  async onMoveUp(e) {
    const { index } = e.currentTarget.dataset;
    const groups = this.data.groups;
    if (index <= 0) return;
    await this.swapSort(groups[index]._id, groups[index].sort, groups[index - 1]._id, groups[index - 1].sort);
  },

  async onMoveDown(e) {
    const { index } = e.currentTarget.dataset;
    const groups = this.data.groups;
    if (index >= groups.length - 1) return;
    await this.swapSort(groups[index]._id, groups[index].sort, groups[index + 1]._id, groups[index + 1].sort);
  },

  async swapSort(id1, sort1, id2, sort2) {
    try {
      await Promise.all([
        dbUtil.updateGroup(id1, { sort: sort2 }),
        dbUtil.updateGroup(id2, { sort: sort1 }),
      ]);
      this.loadGroups();
    } catch (err) {
      wx.showToast({ title: '排序失败', icon: 'none' });
    }
  },

  // ========== 删除 ==========
  onDeleteGroup(e) {
    const { id, name } = e.currentTarget.dataset;
    wx.showModal({
      title: '确认删除',
      content: `删除"${name}"后，该群用户将变为"未加入"。确认？`,
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
