// utils/winter.js - 冬训营模块云函数封装
const FUNC = 'winterTraining';

async function call(action, data = {}) {
  const res = await wx.cloud.callFunction({ name: FUNC, data: { action, data } });
  return res.result || {};
}

// 统一错误处理：云函数返回 { ok:false, error } 时不弹 toast，交由页面决定
const api = {
  intro: () => call('intro'),
  bootstrap: () => call('bootstrap'),
  submitApply: (data) => call('submitApply', data),
  myGroup: () => call('myGroup'),
  setKpiRange: (data) => call('setKpiRange', data),
  submitKpi: (data) => call('submitKpi', data),
  checkin: (data) => call('checkin', data),
  myCheckins: (data) => call('myCheckins', data),
  applyLeave: (data) => call('applyLeave', data),
  myLeaves: (data) => call('myLeaves', data),
  reviewLeave: (data) => call('reviewLeave', data),
  groupCheckins: (data) => call('groupCheckins', data),
  pendingReview: () => call('pendingReview'),
  quitGroup: () => call('quitGroup'),
  reviewCheckin: (data) => call('reviewCheckin', data),
  // 队长：审批入队申请 / 切换缴费 / 转让角色
  leaderApplies: () => call('leaderApplies'),
  leaderReviewApply: (data) => call('leaderReviewApply', data),
  setFeeStatus: (data) => call('setFeeStatus', data),
  // 队长/教练：编辑本组宣言与照片
  leaderSaveGroup: (data) => call('leaderSaveGroup', data),
  transferRole: (data) => call('transferRole', data),
  weeklyStats: (data) => call('weeklyStats', data),
  publishSchedule: (data) => call('publishSchedule', data),
  getSchedule: (data) => call('getSchedule', data),
  readSchedule: (data) => call('readSchedule', data),
  myProfile: () => call('myProfile'),

  // 管理组后台
  adminOverview: () => call('adminOverview'),
  adminSaveGroup: (data) => call('adminSaveGroup', data),
  adminDeleteGroup: (data) => call('adminDeleteGroup', data),
  adminGroupStaff: (data) => call('adminGroupStaff', data),
  adminSetStaff: (data) => call('adminSetStaff', data),
  adminApplies: (data) => call('adminApplies', data),
  adminReviewApply: (data) => call('adminReviewApply', data),
  adminMembers: (data) => call('adminMembers', data),
  adminTransfer: (data) => call('adminTransfer', data),
  adminRemark: (data) => call('adminRemark', data),

  adminCalcWeek: (data) => call('adminCalcWeek', data),
  adminSetPhase: (data) => call('adminSetPhase', data),
  adminFinance: () => call('adminFinance'),
  adminUpdateFinance: (data) => call('adminUpdateFinance', data),
  adminConfirmQuit: (data) => call('adminConfirmQuit', data),
};

// 上传打卡截图到云存储，返回 fileID
function uploadCheckinImage(filePath) {
  return new Promise((resolve, reject) => {
    const ext = (filePath.split('.').pop() || 'png').toLowerCase();
    const cloudPath = `winter_checkin/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    wx.cloud.uploadFile({
      cloudPath,
      filePath,
      success: (r) => resolve(r.fileID),
      fail: reject,
    });
  });
}

// cloud:// 转 http 临时链接（开发者工具不支持 cloud:// 直渲）
async function toTempUrl(fileID) {
  if (!fileID) return '';
  if (String(fileID).indexOf('cloud://') !== 0) return fileID;
  try {
    const res = await wx.cloud.callFunction({ name: 'getImageUrls', data: { fileIDs: [fileID] } });
    const f = (res.result || [])[0];
    if (f && f.tempFileURL) return f.tempFileURL;
  } catch (e) { /* ignore */ }
  try {
    const r = await wx.cloud.getTempFileURL({ fileList: [fileID] });
    const f = r.fileList && r.fileList[0];
    if (f && f.tempFileURL) return f.tempFileURL;
  } catch (e) { /* ignore */ }
  return fileID;
}

// 批量把列表里的 cloud:// 头像转成 https 临时链接。
// 注意：image 组件不支持 cloud:// 协议，且临时链接带签名(t)会过期，故每次加载都要重新转换。
async function resolveAvatars(list) {
  if (!Array.isArray(list) || !list.length) return list || [];
  const ids = [];
  const seen = {};
  list.forEach((it) => {
    const a = it && it.avatarUrl;
    if (a && String(a).indexOf('cloud://') === 0 && !seen[a]) { seen[a] = 1; ids.push(a); }
  });
  if (!ids.length) return list;

  const map = {};
  try {
    const res = await wx.cloud.callFunction({ name: 'getImageUrls', data: { fileIDs: ids } });
    (res.result || []).forEach((f) => { if (f && f.tempFileURL) map[f.fileID] = f.tempFileURL; });
  } catch (e) { /* ignore */ }
  // 批量接口部分失败时逐个兜底重试
  for (const id of ids) {
    if (map[id]) continue;
    try {
      const r = await wx.cloud.getTempFileURL({ fileList: [id] });
      const f = r.fileList && r.fileList[0];
      if (f && f.tempFileURL) map[id] = f.tempFileURL;
    } catch (e) { /* ignore */ }
  }
  return list.map((it) => {
    if (!it) return it;
    let avatarUrl = it.avatarUrl || '';
    if (map[avatarUrl]) {
      avatarUrl = map[avatarUrl];
    } else if (String(avatarUrl).indexOf('cloud://') === 0) {
      avatarUrl = ''; // 转换失败：置空，避免 image 拿到 cloud:// 报渲染层错误，改由文字头像兜底
    }
    const nick = String(it.nickName || it.name || '').trim();
    return { ...it, avatarUrl, avatarInitial: nick ? nick.charAt(0).toUpperCase() : '?' };
  });
}

// 单个对象/列表统一处理：头像转链失败时置空，交给 wxml 兜底显示文字头像
async function pickAvatar(obj) {
  if (!obj) return obj;
  const one = await resolveAvatars([obj]);
  return one[0];
}

const ROLE_TEXT = { member: '队员', leader: '队长', coach: '教练' };
const PHASE_TEXT = { closed: '未开放', trial: '报名/试运行', formal: '正式进行', holiday: '春节假期（不考核）' };

// 跳过考核的原因 → 页面提示（此时打卡照常开放，仅不做考核判定）
const FROZEN_TEXT = {
  trial: '🌱 报名/试运行阶段：可正常打卡，不计 KPI、不计连续、不结算榜单',
  holiday: '❄️ 春节放假周：可自愿打卡，本周不计 KPI、不计连续、不发红包、不参与榜单',
};
const STATUS_TEXT = { pending: '待审核', approved: '已通过', rejected: '已驳回', 'quit-suggested': '建议退出', quit: '已退出' };

module.exports = {
  api, uploadCheckinImage, toTempUrl, resolveAvatars, pickAvatar,
  ROLE_TEXT, PHASE_TEXT, STATUS_TEXT, FROZEN_TEXT,
};
