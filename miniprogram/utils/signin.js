// utils/signin.js - 签到 / 补签卡 云函数封装 + 本地缓存
const FUNC = 'signin';
const CACHE_KEY = 'signin_cache';
const CACHE_TTL = 5 * 60 * 1000; // 5 分钟缓存

async function call(action, data = {}) {
  const res = await wx.cloud.callFunction({ name: FUNC, data: { action, ...data } });
  return res.result || {};
}

// 读缓存（过期返回 null）
function readCache() {
  try {
    const c = wx.getStorageSync(CACHE_KEY);
    if (c && c.data && c.ts && Date.now() - c.ts < CACHE_TTL) {
      return c.data;
    }
  } catch (e) { /* 忽略 */ }
  return null;
}

function writeCache(data) {
  try {
    wx.setStorageSync(CACHE_KEY, { data, ts: Date.now() });
  } catch (e) { /* 忽略 */ }
}

// 清除缓存（签到/兑换/补签后调用）
function clearCache() {
  try { wx.removeStorageSync(CACHE_KEY); } catch (e) { /* 忽略 */ }
}

// 读取签到信息（优先缓存，未命中才查库）
// month 参数：查看指定月份的签到明细（格式 YYYY-MM，默认当前月）
async function getInfo(forceRefresh = false, month = '') {
  if (!forceRefresh && !month) {
    const cached = readCache();
    if (cached) return cached;
  }
  const data = {};
  if (month) data.month = month;
  const res = await call('info', data);
  if (res && res.ok && !month) writeCache(res); // 只有默认当月才写缓存
  return res;
}

function doSign(useCard) {
  return call('sign', { useCard: !!useCard });
}
function getCards() { return call('cards'); }
function exchangeCard() { return call('exchange'); }
function useCard(cardId, targetDate) { return call('useCard', { cardId, targetDate }); }

module.exports = {
  call, getInfo, doSign, getCards, exchangeCard, useCard,
  clearCache, readCache, writeCache,
};
