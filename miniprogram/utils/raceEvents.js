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
  const data = { skip: 0, limit: 20 };
  if (params.search !== undefined) data.search = params.search;
  if (params.dateFrom !== undefined) data.dateFrom = params.dateFrom;
  if (params.dateTo !== undefined) data.dateTo = params.dateTo;
  if (params.raceType !== undefined) data.raceType = params.raceType;
  if (params.raceLevel !== undefined) data.raceLevel = params.raceLevel;
  if (params.raceLabel !== undefined) data.raceLabel = params.raceLabel;
  if (params.userId !== undefined) data.userId = params.userId;
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
    return await db.collection('race_markers').doc(exist.data[0]._id).update({ data });
  }
  return await db.collection('race_markers').add({
    data: { userId, eventId, ...data, createTime: new Date() }
  });
}

/** 取消标记 */
async function unmarkEvent(userId, eventId) {
  return await db.collection('race_markers')
    .where({ userId, eventId }).remove();
}

/** 获取用户标记的赛事 */
async function getMyMarkers(userId) {
  return await db.collection('race_markers')
    .where({ userId }).get();
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
  getReviewStats,
};
