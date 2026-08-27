// utils/points.js - 积分操作工具
const dbUtil = require('./db');
const db = dbUtil.db;
const _ = dbUtil._;

// ============ 积分规则 ============

/** 获取所有积分规则（含禁用，不含已删除） */
async function getRules() {
  // 查询时即排除已删除规则，避免软删除记录累积挤占客户端 20 条查询上限
  const res = await db.collection('points_rules').where({ status: _.neq('deleted') }).get();
  return { data: (res.data || []).filter(r => r.status !== 'deleted') };
}

// 不再自动生成默认规则：积分规则全部由超管手工配置，避免删掉的规则被重新创建
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

/** 删除积分规则（软删除，已删除规则不再展示且不会被重新创建） */
async function deleteRule(ruleId) {
  return await db.collection('points_rules').doc(ruleId).update({
    data: { status: 'deleted', updateTime: new Date() },
  });
}

/**
 * 旧数据迁移：去掉 category 字段，三个固定自动发放类型改用规则名称取值
 * （注册赠送 / 集体活动 / 赛事评分奖励 规则名称需为固定值），不覆盖超管已配置
 */
async function migrateRules() {
  const fixedNames = ['注册赠送', '集体活动', '赛事评分奖励'];
  const res = await db.collection('points_rules').where({ status: _.neq('deleted') }).get();
  for (const r of res.data || []) {
    try {
      const patch = {};
      // 旧规则 category 是固定类型但规则名称不是时，用 category 补成固定规则名称
      if (r.category && fixedNames.includes(r.category) && !fixedNames.includes(r.name)) {
        patch.name = r.category;
      }
      // 移除遗留的 category 字段
      if (r.category != null) {
        patch.category = _.remove();
      }
      if (Object.keys(patch).length > 0) {
        await db.collection('points_rules').doc(r._id).update({ data: patch });
      }
    } catch (e) { console.warn('migrateRules skip', r._id, e); }
  }
}

/** 判断规则是否需要用户提交（兼容旧数据：三个固定自动发放类型默认无需提交） */
function isNeedSubmit(rule) {
  if (!rule) return false;
  if (rule.needSubmit === true) return true;
  if (rule.needSubmit === false) return false;
  // 旧数据无 needSubmit 时按规则名称（或遗留 category）判断
  const legacyKey = rule.name || rule.category || '';
  return !['注册赠送', '集体活动', '赛事评分奖励'].includes(legacyKey);
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

/** 获取指定规则名称的积分值：仅「启用」的规则发分，禁用/删除/未配置一律返回 0（不发分） */
async function getRulePoints(name) {
  try {
    const res = await db.collection('points_rules')
      .where({ name, status: 'active' })
      .limit(1)
      .get();
    if (res.data && res.data.length > 0) {
      const rule = res.data[0];
      // 仅注册赠送支持随机范围（minPoints/maxPoints 都有效时在区间内随机取整数，抢红包效果）
      if (name === '注册赠送') {
        const min = parseInt(rule.minPoints, 10);
        const max = parseInt(rule.maxPoints, 10);
        if (!isNaN(min) && !isNaN(max) && min > 0 && max >= min) {
          return min + Math.floor(Math.random() * (max - min + 1));
        }
      }
      if (rule.points != null) {
        return parseInt(rule.points, 10) || 0;
      }
    }
  } catch (e) { console.warn('getRulePoints error', name, e); }
  return 0;
}

// ============ 积分流水 ============

/** 统计用户已通过流水总积分（分页拉全，避免小程序端单次查询 20 条上限） */
async function sumApprovedPoints(userId) {
  const PAGE = 20;
  let total = 0;
  let skip = 0;
  while (true) {
    const res = await db.collection('points_records').where({
      userId, status: 'approved',
    }).skip(skip).limit(PAGE).get();
    const list = res.data || [];
    if (list.length === 0) break;
    total += list.reduce((s, r) => s + r.points, 0);
    if (list.length < PAGE) break;
    skip += PAGE;
  }
  return total;
}

/** 获取用户积分余额（优先直接读 users.points 余额字段；老用户字段缺失时回退统计流水） */
async function getBalance(userId) {
  try {
    const u = await db.collection('users').doc(userId).get();
    if (u.data && typeof u.data.points === 'number') return u.data.points;
  } catch (e) { /* 用户不存在或读取失败，回退统计 */ }
  return await sumApprovedPoints(userId);
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

/** 增量更新用户余额：有字段用原子自增；老用户无 points 字段时按流水重算回填 */
async function incUserPoints(userId, delta) {
  try {
    const u = await db.collection('users').doc(userId).get();
    if (u.data && typeof u.data.points === 'number') {
      await db.collection('users').doc(userId).update({ data: { points: _.inc(delta) } });
      return;
    }
  } catch (e) { /* 用户不存在则忽略 */ }
  const balance = await sumApprovedPoints(userId);
  await db.collection('users').doc(userId).update({ data: { points: balance } });
}

/** 添加积分记录 */
async function addRecord(data) {
  const idRes = await db.collection('points_records').add({ data: { ...data, createTime: new Date() } });
  // 增量同步用户积分余额（原子自增，避免重算受客户端查询条数限制）
  await incUserPoints(data.userId, data.points || 0);
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
  // 审批通过后按本次积分增量同步用户余额
  if (status === 'approved') {
    const rec = await db.collection('points_records').doc(recordId).get();
    await incUserPoints(rec.data.userId, rec.data.points || 0);
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
    // 同步扣减用户余额（避免余额字段与流水不一致）
    await db.collection('users').doc(r.userId).update({ data: { points: _.inc(-r.points) } });
  }
  return overdue.data.length;
}

module.exports = {
  getRules, addRule, deleteRule, updateRule, migrateRules,
  isNeedSubmit, parseRuleLimit, getRuleLimitText, getPeriodRange, getPeriodCount, checkRuleLimit, getRulePoints,
  getBalance, getExpiringSoon, getRecords, addRecord,
  getMonthlyCount, reviewRecord, getPendingRecords, withdrawRecord,
  expireOverduePoints,
};
