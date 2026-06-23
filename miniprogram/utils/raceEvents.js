// utils/raceEvents.js - 赛事数据操作
const dbUtil = require('./db');
const db = dbUtil.db;

/** 获取赛事列表（管理员） */
async function getList(skip = 0, limit = 20) {
  return await db.collection('race_events').orderBy('date', 'desc').skip(skip).limit(limit).get();
}

/** 获取所有赛事 */
async function getAll() {
  const count = await db.collection('race_events').count();
  const batchTimes = Math.ceil(count.total / 100);
  const tasks = [];
  for (let i = 0; i < batchTimes; i++) {
    tasks.push(db.collection('race_events').orderBy('date', 'asc').skip(i * 100).limit(100).get());
  }
  const results = await Promise.all(tasks);
  return results.reduce((arr, r) => arr.concat(r.data), []);
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
async function markEvent(userId, eventId, status) {
  const exist = await db.collection('race_markers')
    .where({ userId, eventId }).get();
  if (exist.data.length > 0) {
    return await db.collection('race_markers').doc(exist.data[0]._id).update({
      data: { status, updateTime: new Date() }
    });
  }
  return await db.collection('race_markers').add({
    data: { userId, eventId, status, createTime: new Date() }
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

/** 获取赛事评分统计 */
async function getReviewStats(eventId) {
  const res = await db.collection('race_reviews')
    .where({ eventId, status: 'approved' }).get();
  const count = res.data.length;
  if (count === 0) return { count: 0, avgScore: 0, dimensions: {}, tagStats: {} };

  const dims = {};
  const tags = {};
  let total = 0;
  res.data.forEach(r => {
    const scores = r.scores || {};
    let sum = 0;
    let dimCount = 0;
    Object.keys(scores).forEach(k => {
      dims[k] = (dims[k] || 0) + scores[k];
      sum += scores[k];
      dimCount++;
    });
    total += sum / dimCount;
    (r.tags || []).forEach(t => { tags[t] = (tags[t] || 0) + 1; });
  });

  const avgScore = Math.round(total / count * 10) / 10;
  const dimensions = {};
  Object.keys(dims).forEach(k => { dimensions[k] = Math.round(dims[k] / count * 10) / 10; });

  return { count, avgScore, dimensions, tagStats: tags };
}

module.exports = {
  getList, getAll, create, update, remove,
  markEvent, unmarkEvent, getMyMarkers,
  getReviewStats,
};
