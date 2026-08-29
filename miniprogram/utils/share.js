// utils/share.js - 转发工具

// 默认品牌分享图（本地图片，微信分享卡片最可靠）
const DEFAULT_IMAGE = '/imgs/jiuzhouzhanma.jpg';

/** 开启右上角「转发」「分享到朋友圈」菜单（页面 onLoad/onShow 调用） */
function enableShareMenu() {
  try {
    wx.showShareMenu({
      withShareTicket: true,
      menus: ['shareAppMessage', 'shareTimeline'],
    });
  } catch (e) { /* 基础库版本过低时忽略 */ }
}

/** 构造转发配置（onShareAppMessage 返回值），自动处理默认图 */
function buildShare({ title, path, imageUrl }) {
  return {
    title: title || '九州战马联盟',
    path: path || '/pages/home/home',
    imageUrl: imageUrl || DEFAULT_IMAGE,
  };
}

/** 构造朋友圈分享配置（onShareTimeline 返回值） */
function buildTimeline({ title, query, imageUrl }) {
  return {
    title: title || '九州战马联盟',
    query: query || '',
    imageUrl: imageUrl || DEFAULT_IMAGE,
  };
}

module.exports = { enableShareMenu, buildShare, buildTimeline, DEFAULT_IMAGE };
