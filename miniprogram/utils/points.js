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
    { category: '拉新', name: '邀请跑友加入', points: 3, period: '', limitCount: 0, status: 'active' },
    { category: '团服参赛', name: '穿团服参加赛事', points: 5, period: '', limitCount: 0, status: 'active' },
    { category: '自媒体', name: '带话题并@九州战马联盟', points: 3, period: '', limitCount: 0, status: 'active' },
    { category: '天天跑完赛', name: '必迈天天跑完成10次打卡', points: 10, period: '', limitCount: 0, status: 'active' },
    { category: '赛事评分奖励', name: '完成赛事体验评分（审核通过后自动发放）', points: 10, period: '', limitCount: 0, status: 'active' },
    { category: '集体活动', name: '赛前聚餐、赛前合影、线下集体活动（管理员录入）', points: 3, period: '', limitCount: 0, status: 'active' },
    { category: '注册赠送', name: '新用户注册赠送', points: 50, minPoints: 30, maxPoints: 60, period: '', limitCount: 0, status: 'active' },
  ];
  const count = await db.collection('points_rules').count();
  if (count.total === 0) {
    for (const r of defaults) {
      await db.collection('points_rules').add({ data: r });
    }
    return;
  }
  // 只补缺失规则，不覆盖已有规则（保留超管自定义）
  for (const d of defaults) {
    const existRes = await db.collection('points_rules').where({ category: d.category }).limit(1).get();
    if (existRes.data.length === 0) {
      await db.collection('points_rules').add({ data: d });
    } else {
      // 已存在但缺少新字段时补充（不覆盖已有值）：旧规则无随机区间时补入默认值
      const existRule = existRes.data[0];
      const patch = {};
      if (d.minPoints != null && existRule.minPoints == null) patch.minPoints = d.minPoints;
      if (d.maxPoints != null && existRule.maxPoints == null) patch.maxPoints = d.maxPoints;
      if (Object.keys(patch).length > 0) {
        await db.collection('points_rules').doc(existRule._id).update({ data: patch });
      }
    }
  }
}

/** 更新规则 */
async function updateRule(ruleId, data) {
  return await db.collection('points_rules').doc(ruleId).update({ data });
}

/** 新增积分规则 */
async function addRule(data) {
  return await db.collection('points_rules').add({
    data: { ...data, createTime: new Date(), updateTime: new Date() }
  });
}

/** 删除积分规则 */
async function deleteRule(ruleId) {
  return await db.collection('points_rules').doc(ruleId).remove();
}

/** 解析规则限制（兼容旧 monthlyLimit 字段） */
function parseRuleLimit(rule) {
  if (!rule) return { period: '', limitCount: 0 };
  let period = rule.period || '';
  let limitCount = parseInt(rule.limitCount, 10) || 0;
  if (!period && rule.monthlyLimit) {
    period = 'month';
    limitCount = parseInt(rule.monthlyLimit, 10) || 0;
  }
  return { period, limitCount };
}

/** 规则限制文案（如：每月最多4次） */
function getRuleLimitText(rule) {
  const { period, limitCount } = parseRuleLimit(rule);
  if (!period || !limitCount) return '';
  const p = { day: '每天', week: '每周', month: '每月' }[period] || '';
  return p + '最多' + limitCount + '次';
}

/** 计算自然周期起止时间（日/自然周从周一起/自然月从1号起） */
function getPeriodRange(period) {
  const now = new Date();
  let start, end;
  if (period === 'day') {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  } else if (period === 'week') {
    const day = now.getDay(); // 0=Sunday
    const diffToMonday = (day + 6) % 7;
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffToMonday);
    end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffToMonday + 7);
  } else { // month
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  }
  return { start, end };
}

/** 获取用户在指定自然周期内已提交次数（pending + approved） */
async function getPeriodCount(userId, category, period) {
  if (!period) return 0;
  const { start, end } = getPeriodRange(period);
  const res = await db.collection('points_records').where({
    userId, category,
    status: _.in(['pending', 'approved']),
    createTime: _.gte(start).and(_.lt(end)),
  }).count();
  return res.total;
}

/** 校验规则周期/次数限制 */
async function checkRuleLimit(userId, category, rule) {
  const { period, limitCount } = parseRuleLimit(rule);
  if (!period || !limitCount) return { ok: true, used: 0, limit: 0 };
  const used = await getPeriodCount(userId, category, period);
  return { ok: used < limitCount, used, limit: limitCount };
}

/** 获取指定分类的有效规则积分值（未找到或禁用时返回默认值） */
async function getRulePoints(category, fallback) {
  try {
    const res = await db.collection('points_rules')
      .where({ category, status: 'active' })
      .limit(1)
      .get();
    if (res.data && res.data.length > 0) {
      const rule = res.data[0];
      // 仅注册赠送支持随机范围（minPoints/maxPoints 都有效时在区间内随机取整数，抢红包效果）
      if (category === '注册赠送') {
        const min = parseInt(rule.minPoints, 10);
        const max = parseInt(rule.maxPoints, 10);
        if (!isNaN(min) && !isNaN(max) && min > 0 && max >= min) {
          return min + Math.floor(Math.random() * (max - min + 1));
        }
      }
      if (rule.points != null) {
        return rule.points;
      }
    }
  } catch (e) { console.warn('getRulePoints error', category, e); }
  return fallback;
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
  getRules, initDefaultRules, addRule, deleteRule, updateRule,
  parseRuleLimit, getRuleLimitText, getPeriodRange, getPeriodCount, checkRuleLimit, getRulePoints,
  getBalance, getExpiringSoon, getRecords, addRecord,
  getMonthlyCount, reviewRecord, getPendingRecords, withdrawRecord,
  expireOverduePoints,
};
