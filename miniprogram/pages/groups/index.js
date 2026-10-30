// pages/groups/index.js - 跑群列表（用户查看）
const dbUtil = require('../../utils/db');
const cache = require('../../utils/cache');

const LIST_KEY = 'groups_public_list';
const LIST_TTL = 10 * 60 * 1000;   // 群很少变动，10 分钟够用

Page({
  data: {
    groups: [],
    expandedId: '',
  },

  async onShow() {
    // 先把上次的数据渲染出来，再静默刷新：进页面不该对着白屏等网络
    const cached = cache.get(LIST_KEY);
    if (cached && cached.length) this.setData({ groups: cached });
    try {
      const { data } = await cache.load(
        LIST_KEY,
        async () => enrich(await dbUtil.getGroups()),
        { ttl: LIST_TTL, versionKey: 'groups_v1' },
      );
      if (data !== this.data.groups) this.setData({ groups: data });
    } catch {
      if (!cached || !cached.length) wx.showToast({ title: '加载失败', icon: 'none' });
    }
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

// 批量换二维码临时链接：一次调用拿全部。
// 原来是每个群单独 getTempFileURL 一次，群一多就是十几次串行往返。
async function enrich(res) {
  const items = ((res && res.data) || []).map(g => ({
    ...g,
    description: g.description || '',
    remark: g.remark || '群已满，请联系管理员邀请加入',
  }));

  const cloudIds = [];
  for (const g of items) {
    if (g.qrCode && String(g.qrCode).indexOf('cloud://') === 0) cloudIds.push(g.qrCode);
  }

  const map = {};
  // getTempFileURL 单次上限 50 个 fileID
  for (let i = 0; i < cloudIds.length; i += 50) {
    try {
      const r = await wx.cloud.getTempFileURL({ fileList: cloudIds.slice(i, i + 50) });
      (r.fileList || []).forEach(f => { if (f && f.tempFileURL) map[f.fileID] = f.tempFileURL; });
    } catch {}
  }

  for (const g of items) {
    if (!g.qrCode) continue;
    const raw = String(g.qrCode);
    // 换不到（权限/过期）就留空，页面会退化为显示「群已满」文案
    g.qrCodeUrl = map[raw] || (raw.indexOf('cloud://') === 0 ? '' : raw);
  }
  return items;
}
