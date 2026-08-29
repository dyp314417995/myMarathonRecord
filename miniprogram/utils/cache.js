// utils/cache.js - 列表本地缓存统一处理
// 目的：避免每次切 tab / 返回页面都重复查库（慢 + 浪费资源）
// 原则：
//   1. 缓存未过期且版本一致 → 直接用缓存，不再查库
//   2. 只有真正查库成功后才写缓存
//   3. 数据变更后调用 invalidate(domain) 使缓存失效，下次加载强制查库
// 用法：
//   const cache = require('../../utils/cache');
//   const { data, fromCache } = await cache.load(key, () => 查库(), { ttl, force, versionKey });
//   cache.invalidate('members');   // 会员数据变了，让相关缓存失效

const PREFIX = 'cache_';
const DEFAULT_TTL = 5 * 60 * 1000; // 默认 5 分钟

function k(key) { return PREFIX + key; }

function _read(key) {
  try {
    const raw = wx.getStorageSync(key);
    if (!raw || typeof raw !== 'string') return null;
    return JSON.parse(raw);
  } catch (e) { return null; }
}

/** 读取未过期缓存（不做版本校验），无则返回 null */
function get(key) {
  const obj = _read(k(key));
  if (!obj || typeof obj._t !== 'number') return null;
  if (Date.now() - obj._t > (obj._ttl || DEFAULT_TTL)) return null;
  return obj._d;
}

/** 写缓存（versionKey 传入则写入当前版本，配合 invalidate 使用） */
function set(key, data, ttl, versionKey) {
  try {
    wx.setStorageSync(k(key), JSON.stringify({ _t: Date.now(), _ttl: ttl || DEFAULT_TTL, _v: getVer(versionKey || ''), _d: data }));
  } catch (e) {}
}

/** 删缓存 */
function remove(key) {
  try { wx.removeStorageSync(k(key)); } catch (e) {}
}

/** 使某个业务域的缓存全部失效（数据变更后调用，下次加载强制查库） */
function invalidate(domain) {
  try {
    wx.setStorageSync(k('ver_' + domain), (wx.getStorageSync(k('ver_' + domain)) || 0) + 1);
  } catch (e) {}
}

/** 读取业务域版本号 */
function getVer(domain) {
  try { return wx.getStorageSync(k('ver_' + domain)) || 0; } catch (e) { return 0; }
}

/**
 * 列表统一加载：
 *   - 缓存未过期且版本一致 → 直接返回缓存（fromCache=true），不查库
 *   - 否则执行 loader 查库，成功后写缓存（fromCache=false）
 * @param {string} cacheKey 缓存键（不同查询条件用不同 key）
 * @param {Function} loader 查库函数，返回数据
 * @param {Object} [opts] { ttl, force, versionKey }
 * @returns {Promise<{data: any, fromCache: boolean}>}
 */
async function load(cacheKey, loader, opts = {}) {
  const { ttl, force, versionKey } = opts || {};
  if (!force) {
    const obj = _read(k(cacheKey));
    if (obj && typeof obj._t === 'number'
        && Date.now() - obj._t <= (obj._ttl || DEFAULT_TTL)
        && obj._v === getVer(versionKey || '')) {
      return { data: obj._d, fromCache: true };
    }
  }
  const data = await loader();
  if (data !== undefined && data !== null) {
    try {
      wx.setStorageSync(k(cacheKey), JSON.stringify({ _t: Date.now(), _ttl: ttl || DEFAULT_TTL, _v: getVer(versionKey || ''), _d: data }));
    } catch (e) {}
  }
  return { data, fromCache: false };
}

module.exports = { get, set, remove, invalidate, getVer, load, DEFAULT_TTL };