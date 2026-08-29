// utils/raceEvents.js - 赛事数据操作
const dbUtil = require('./db');
const db = dbUtil.db;

/** 获取赛事列表（管理员，使用云函数绕过权限） */
async function getList(skip = 0, limit = 20) {
  const res = await wx.cloud.callFunction({ name: 'getRaceEvents' });
  const all = res.result || [];
  all.sort((a, b) => new Date(b.date) - new Date(a.date));
  return { data: all.slice(skip, skip + limit) };
}

/** 分页获取赛事（服务端筛选+分页） */
async function getAll(params = {}) {
  const data = { skip: params.skip || 0, limit: params.limit || 20 };
  if (params.search !== undefined) data.search = params.search;
  if (params.dateFrom !== undefined) data.dateFrom = params.dateFrom;
  if (params.dateTo !== undefined) data.dateTo = params.dateTo;
  if (params.raceType !== undefined) data.raceType = params.raceType;
  if (params.raceLevel !== undefined) data.raceLevel = params.raceLevel;
  if (params.raceLabel !== undefined) data.raceLabel = params.raceLabel;
  if (params.userId !== undefined) data.userId = params.userId;
  if (params.publishFilter !== undefined) data.publishFilter = params.publishFilter;
  if (params.sortBy !== undefined) data.sortBy = params.sortBy;
  const res = await wx.cloud.callFunction({ name: 'getRaceEvents', data });
  return res.result || { list: [], total: 0, hasMore: false };
}

/** 加载更多赛事 */
async function loadMore(params = {}) {
  const res = await wx.cloud.callFunction({
    name: 'getRaceEvents',
    data: params
  });
  return res.result || { list: [], total: 0, hasMore: false };
}

/** 创建赛事 */
async function create(data) {
  return await db.collection('race_events').add({
    data: { ...data, createTime: new Date() }
  });
}

/** 更新赛事 */
async function update(id, data) {
  return await db.collection('race_events').doc(id).update({ data });
}

/** 删除赛事 */
async function remove(id) {
  return await db.collection('race_events').doc(id).remove();
}

/** 标记我的赛事 */
async function markEvent(userId, eventId, status, notifyEnabled = false, raceType = 'full') {
  const data = { status, notifyEnabled, raceType, updateTime: new Date() };
  const exist = await db.collection('race_markers')
    .where({ userId, eventId }).get();
  if (exist.data.length > 0) {
    await db.collection('race_markers').doc(exist.data[0]._id).update({ data });
  } else {
    await db.collection('race_markers').add({
      data: { userId, eventId, ...data, createTime: new Date() }
    });
  }
  syncMarkerCount(eventId).catch(() => {});
  return { ok: true };
}

/** 标记/取消标记后同步 race_events.markerCount（云函数管理员权限，热度排序用） */
async function syncMarkerCount(eventId) {
  if (!eventId) return;
  await wx.cloud.callFunction({
    name: 'getRaceEvents',
    data: { action: 'syncMarkerCount', eventId }
  });
}

/** 取消标记 */
async function unmarkEvent(userId, eventId) {
  await db.collection('race_markers')
    .where({ userId, eventId }).remove();
  syncMarkerCount(eventId).catch(() => {});
  return { ok: true };
}

/** 获取用户标记的赛事 */
async function getMyMarkers(userId) {
  return await db.collection('race_markers')
    .where({ userId }).get();
}

/** 获取赛事详情（单条，含评分统计 + 用户标记/评价） */
async function getEventDetail(eventId, userId) {
  const res = await wx.cloud.callFunction({
    name: 'getEventDetail',
    data: { eventId, userId }
  });
  return res.result || { event: null, reviewStats: null, myMarker: null, myReview: null };
}

/** 获取赛事评分统计（云函数绕过权限） */
async function getReviewStats(eventId) {
  const res = await wx.cloud.callFunction({
    name: 'getRaceReviews',
    data: { action: 'stats', eventId }
  });
  return res.result || { count: 0, avgScore: 0, dimensions: {}, tagStats: {} };
}

module.exports = {
  getList, getAll, create, update, remove,
  markEvent, unmarkEvent, getMyMarkers,
  getReviewStats, getEventDetail,
};
