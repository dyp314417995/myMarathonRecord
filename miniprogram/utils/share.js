// utils/share.js - 转发工具

/** 开启右上角「转发」「分享到朋友圈」菜单（页面 onLoad/onShow 调用） */
function enableShareMenu() {
  try {
    wx.showShareMenu({
      withShareTicket: true,
      menus: ['shareAppMessage', 'shareTimeline'],
    });
  } catch (e) { /* 基础库版本过低时忽略 */ }
}

module.exports = { enableShareMenu };