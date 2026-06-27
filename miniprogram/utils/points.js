// utils/points.js - 积分操作工具
const dbUtil = require('./db');
const db = dbUtil.db;
const _ = dbUtil._;

// ============ 积分规则 ============

/** 获取所有积分规则（含禁用） */
async function getRules() {
  return await db.collection('points_rules').get();
}

/** 初始化或更新默认积分规则 */
async function initDefaultRules() {
  const defaults = [
    { category: '拉新', name: '邀请跑友加入', points: 3, monthlyLimit: null, status: 'active' },
    { category: '团服参赛', name: '穿团服参加赛事', points: 5, monthlyLimit: null, status: 'active' },
    { category: '自媒体', name: '带话题并@九州战马联盟', points: 3, monthlyLimit: null, status: 'active' },
    { category: '天天跑完赛', name: '必迈天天跑完成10次打卡', points: 10, monthlyLimit: null, status: 'active' },
    { category: '赛事评分奖励', name: '完成赛事体验评分（审核通过后自动发放）', points: 10, monthlyLimit: null, status: 'active' },
    { category: '集体活动', name: '赛前聚餐、赛前合影、线下集体活动（管理员录入）', points: 3, monthlyLimit: null, status: 'active' },
  ];
  const count = await db.collection('points_rules').count();
  if (count.total === 0) {
    for (const r of defaults) {
      await db.collection('points_rules').add({ data: r });
    }
    return;
  }
  // 更新已有规则，插入缺失规则
  for (const d of defaults) {
    const exist = await db.collection('points_rules').where({ category: d.category }).get();
    if (exist.data.length > 0) {
      await db.collection('points_rules').where({ category: d.category })
        .update({ data: { name: d.name, points: d.points, monthlyLimit: d.monthlyLimit, status: 'active' } });
    } else {
      await db.collection('points_rules').add({ data: d });
    }
  }
}

/** 更新规则 */
async function updateRule(ruleId, data) {
  return await db.collection('points_rules').doc(ruleId).update({ data });
}

// ============ 积分流水 ============

/** 获取用户积分余额 */
async function getBalance(userId) {
  const res = await db.collection('points_records').where({
    userId, status: 'approved',
  }).get();
  return res.data.reduce((sum, r) => sum + r.points, 0);
}

/** 即将过期的积分 */
async function getExpiringSoon(userId, days) {
  const now = new Date();
  const future = new Date(now.getTime() + days * 86400000);
  return await db.collection('points_records').where({
    userId, type: 'earn', status: 'approved',
    expireDate: _.gte(now).and(_.lte(future)),
  }).orderBy('expireDate', 'asc').get();
}

/** 积分流水列表 */
async function getRecords(userId, skip = 0, limit = 20) {
  return await db.collection('points_records').where({ userId })
    .orderBy('createTime', 'desc').skip(skip).limit(limit).get();
}

/** 添加积分记录 */
async function addRecord(data) {
  const idRes = await db.collection('points_records').add({ data: { ...data, createTime: new Date() } });
  // 同步更新用户积分余额
  const balance = await getBalance(data.userId);
  await db.collection('users').doc(data.userId).update({ data: { points: balance } });
  return idRes._id;
}

/** 获取本月已通过次数 */
async function getMonthlyCount(userId, category) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  const res = await db.collection('points_records').where({
    userId, category, status: 'approved',
    createTime: _.gte(start).and(_.lte(end)),
  }).count();
  return res.total;
}

/** 审批积分记录 */
async function reviewRecord(recordId, status, reviewerId) {
  await db.collection('points_records').doc(recordId).update({
    data: { status, reviewerId, reviewTime: new Date() },
  });
  // 审批通过后同步更新用户积分
  if (status === 'approved') {
    const rec = await db.collection('points_records').doc(recordId).get();
    const balance = await getBalance(rec.data.userId);
    await db.collection('users').doc(rec.data.userId).update({ data: { points: balance } });
  }
}

/** 撤回积分申请（仅 pending 状态可撤） */
async function withdrawRecord(recordId) {
  return await db.collection('points_records').doc(recordId).update({
    data: { status: 'withdrawn', reviewTime: new Date() },
  });
}

/** 获取待审批的积分申请 */
async function getPendingRecords() {
  return await db.collection('points_records').where({ status: 'pending' })
    .orderBy('createTime', 'asc').get();
}

// ============ 过期处理 ============

/** 批量处理过期积分 */
async function expireOverduePoints() {
  const now = new Date();
  const overdue = await db.collection('points_records').where({
    status: 'approved', type: 'earn', expireDate: _.lte(now),
  }).get();
  for (const r of overdue.data) {
    // 扣减余额快照
    await db.collection('points_records').add({
      data: {
        userId: r.userId, type: 'expire', category: '过期',
        points: -r.points, status: 'approved',
        description: `积分过期（${r.createTime} 获得）`,
        earnDate: r.earnDate, expireDate: r.expireDate, createTime: new Date(),
      },
    });
    // 标记原记录为已过期
    await db.collection('points_records').doc(r._id).update({ data: { status: 'expired' } });
  }
  return overdue.data.length;
}

module.exports = {
  getRules, initDefaultRules, updateRule,
  getBalance, getExpiringSoon, getRecords, addRecord,
  getMonthlyCount, reviewRecord, getPendingRecords, withdrawRecord,
  expireOverduePoints,
};
