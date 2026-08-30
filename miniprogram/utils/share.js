// utils/share.js - 转发工具

// 默认品牌分享图（本地图片，微信分享卡片最可靠）
const DEFAULT_IMAGE = '/imgs/jzzm.jpg';

/** 开启右上角「转发」「分享到朋友圈」菜单（页面 onLoad/onShow 调用） */
function enableShareMenu() {
  try {
    wx.showShareMenu({
      withShareTicket: true,
      menus: ['shareAppMessage', 'shareTimeline'],
    });
  } catch (e) { /* 基础库版本过低时忽略 */ }
}

/** 构造转发配置（onShareAppMessage 返回值） */
function buildShare({ title, path, imageUrl }) {
  const cfg = {
    title: title || '九州战马联盟',
    path: path || '/pages/home/home',
  };
  // 仅显式传入 imageUrl 时才带图（赛事海报/活动图等）；否则不设默认图，微信自动截屏当前页面
  if (imageUrl) cfg.imageUrl = imageUrl;
  return cfg;
}

/** 构造朋友圈分享配置（onShareTimeline 返回值） */
function buildTimeline({ title, query, imageUrl }) {
  const cfg = {
    title: title || '九州战马联盟',
    query: query || '',
  };
  if (imageUrl) cfg.imageUrl = imageUrl;
  return cfg;
}

module.exports = { enableShareMenu, buildShare, buildTimeline, DEFAULT_IMAGE };
