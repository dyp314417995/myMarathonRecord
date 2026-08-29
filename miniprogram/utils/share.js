// utils/share.js - 转发工具

// 默认品牌分享图（云存储 fileID）
const DEFAULT_IMAGE = 'cloud://cloud1-d5gy0iuiba5f9300f.636c-cloud1-d5gy0iuiba5f9300f-1430408608/jiuzhouzhanma.jpg';
const IMAGE_CACHE_KEY = 'share_default_image_url';

/** 开启右上角「转发」「分享到朋友圈」菜单（页面 onLoad/onShow 调用） */
function enableShareMenu() {
  try {
    wx.showShareMenu({
      withShareTicket: true,
      menus: ['shareAppMessage', 'shareTimeline'],
    });
  } catch (e) { /* 基础库版本过低时忽略 */ }
}

/** 将默认品牌图 cloud:// 转成临时 https 链接并缓存（app 启动时调用一次） */
async function preloadDefaultImage() {
  try {
    const cached = wx.getStorageSync(IMAGE_CACHE_KEY);
    // 缓存有效期内直接复用（临时链接约2小时有效，这里简单复用）
    if (cached && cached.url && cached.ts && Date.now() - cached.ts < 60 * 60 * 1000) {
      return cached.url;
    }
    const res = await wx.cloud.getTempFileURL({ fileList: [DEFAULT_IMAGE] });
    const file = res.fileList && res.fileList[0];
    if (file && file.tempFileURL) {
      wx.setStorageSync(IMAGE_CACHE_KEY, { url: file.tempFileURL, ts: Date.now() });
      return file.tempFileURL;
    }
  } catch (e) { /* 转换失败则退回 cloud://，至少能显示标题 */ }
  return '';
}

/** 获取默认分享图（优先缓存 https 链接） */
function getDefaultImage() {
  try {
    const cached = wx.getStorageSync(IMAGE_CACHE_KEY);
    if (cached && cached.url) return cached.url;
  } catch (e) { /* 忽略 */ }
  return '';
}

/** 构造转发配置（onShareAppMessage 返回值），自动处理默认图 */
function buildShare({ title, path, imageUrl }) {
  return {
    title: title || '九州战马联盟',
    path: path || '/pages/home/home',
    imageUrl: imageUrl || getDefaultImage(),
  };
}

/** 构造朋友圈分享配置（onShareTimeline 返回值） */
function buildTimeline({ title, query, imageUrl }) {
  return {
    title: title || '九州战马联盟',
    query: query || '',
    imageUrl: imageUrl || getDefaultImage(),
  };
}

module.exports = { enableShareMenu, buildShare, buildTimeline, preloadDefaultImage, getDefaultImage, DEFAULT_IMAGE };
