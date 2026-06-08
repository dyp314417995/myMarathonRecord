// pages/groups/index.js - 跑群列表（用户查看）
const dbUtil = require('../../utils/db');

Page({
  data: {
    groups: [],
    expandedId: '',
  },

  async onShow() {
    const res = await dbUtil.getGroups();
    const enriched = await Promise.all(res.data.map(async (g) => {
      if (!g.description) g.description = '';
      if (!g.remark) g.remark = '群已满，请联系管理员邀请加入';
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

  onToggleGroup(e) {
    const { id } = e.currentTarget.dataset;
    this.setData({ expandedId: this.data.expandedId === id ? '' : id });
  },

  onPreviewQR(e) {
    const { url } = e.currentTarget.dataset;
    if (url) wx.previewImage({ urls: [url] });
  },
});
