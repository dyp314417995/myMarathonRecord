// 云函数：grantMakeupCard - 管理员手动补发补签卡（指定用户 / 全员）
// 权限：仅 super_admin / admin 可调用（服务端按 OPENID 校验，防止越权）
// 用途：运营活动补偿等场景手动补发补签卡，来源记为「运营活动」(source=4)
// 规则与 signin 云函数保持一致：有效期 30 天、每人持有上限 10 张（已达上限者跳过）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const CARD_EXPIRE_DAYS = 30;   // 补签卡有效期（天），与 signin 保持一致
const CARD_HOLD_LIMIT = 10;    // 补签卡持有上限（张），与 signin 保持一致
const SOURCE_MANUAL = 4;       // 来源：运营活动（手动补发）
const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH = 100;             // 云函数单次查询上限

/** 确保审计日志集合存在（幂等） */
async function ensureCollections() {
  try { await db.createCollection('makeup_card_grant'); } catch (e) { /* 已存在则忽略 */ }
}

/** 校验调用者是否为管理员/超管，返回其 userId；否则返回空串 */
async function getAdminUserId(openid) {
  if (!openid) return '';
  const res = await db.collection('users').where({ _openid: openid }).limit(1).get();
  if (!res.data || res.data.length === 0) return '';
  const u = res.data[0];
  return (u.role === 'admin' || u.role === 'super_admin') ? (u._id || '') : '';
}

/** 统计某用户当前有效（未使用且未过期）补签卡数量 */
async function countUsable(userId, now) {
  const res = await db.collection('makeup_card')
    .where({ userId, status: 0, expire_at: _.gt(now) }).count();
  return res.total;
}

/** 给单个用户补发 count 张，受持有上限约束；返回实际发放张数 */
async function grantToUser(userId, count, now, expireAt) {
  const usable = await countUsable(userId, now);
  const room = Math.max(0, CARD_HOLD_LIMIT - usable);
  const n = Math.min(count, room);
  if (n <= 0) return 0;
  const tasks = [];
  for (let i = 0; i < n; i++) {
    tasks.push(db.collection('makeup_card').add({
      data: {
        userId, source: SOURCE_MANUAL, expire_at: expireAt,
        status: 0, used_at: null, created_at: now,
      },
    }));
  }
  await Promise.all(tasks);
  return n;
}

exports.main = async (event = {}) => {
  await ensureCollections();
  const { OPENID } = cloud.getWXContext();
  const operatorId = await getAdminUserId(OPENID);
  if (!operatorId) {
    return { ok: false, code: 'NO_PERMISSION', msg: '仅管理员可操作' };
  }

  const action = event.action || 'grant';
  const now = new Date();
  const expireAt = new Date(now.getTime() + CARD_EXPIRE_DAYS * DAY_MS);

  // ---------- action: info（规则常量 + 可选用户当前持有量） ----------
  if (action === 'info') {
    let usable = 0;
    if (event.userId) {
      try { usable = await countUsable(event.userId, now); } catch (e) { /* 忽略 */ }
    }
    return {
      ok: true,
      hold_limit: CARD_HOLD_LIMIT,
      expire_days: CARD_EXPIRE_DAYS,
      source: SOURCE_MANUAL,
      usable_cards: usable,
    };
  }


  // ---------- action: logs（发放记录，最近优先，分页） ----------
  if (action === 'logs') {
    const skip = Math.max(parseInt(event.skip, 10) || 0, 0);
    const limit = Math.min(parseInt(event.limit, 10) || 20, 50);
    const res = await db.collection('makeup_card_grant')
      .orderBy('created_at', 'desc').skip(skip).limit(limit).get();
    const rows = res.data || [];
    const idSet = new Set();
    rows.forEach(r => {
      if (r.operatorId) idSet.add(r.operatorId);
      (r.userIds || []).forEach(uid => idSet.add(uid));
    });
    const nameMap = {};
    const ids = [...idSet];
    for (let i = 0; i < ids.length; i += 20) {
      const part = ids.slice(i, i + 20);
      const q = await db.collection('users')
        .where({ _id: _.in(part) }).field({ nickName: true }).get();
      (q.data || []).forEach(u => { nameMap[u._id] = u.nickName || '未知'; });
    }
    const logs = rows.map(r => {
      const isAll = r.target === 'all';
      const targetText = isAll ? '全员' : ((r.userIds || []).map(uid => nameMap[uid] || '未知').join('、') || '未知');
      const detail = isAll
        ? '每人补发 ' + r.count + ' 张：成功 ' + r.granted + ' 张，跳过 ' + (r.skipped || 0) + ' 人'
        : '共发放 ' + r.granted + ' 张' + ((r.skipped || 0) > 0 ? '（跳过 ' + r.skipped + ' 人）' : '');
      return {
        _id: r._id,
        opName: nameMap[r.operatorId] || '管理员',
        targetText,
        detail,
        created_at: r.created_at,
      };
    });
    return { ok: true, logs, hasMore: rows.length >= limit };
  }

  // ---------- action: grant（补发） ----------
  const count = Math.max(1, Math.min(parseInt(event.count, 10) || 1, 99));
  const target = event.target === 'all' ? 'all' : 'user';

  if (target === 'user') {
    // 支持单个 userId 或数组 userIds（多选批量补发）
    let userIds = Array.isArray(event.userIds) ? event.userIds : (event.userId ? [event.userId] : []);
    userIds = [...new Set(userIds.filter(Boolean))];
    if (userIds.length === 0) return { ok: false, code: 'NO_USER', msg: '请选择用户' };
    let grantedTotal = 0;
    let skipped = 0;
    for (const userId of userIds) {
      let exists = false;
      try { await db.collection('users').doc(userId).get(); exists = true; } catch (e) { /* 用户不存在 */ }
      if (!exists) { skipped += 1; continue; }
      const g = await grantToUser(userId, count, now, expireAt);
      grantedTotal += g;
      if (g === 0) skipped += 1;
    }
    await db.collection('makeup_card_grant').add({
      data: {
        operatorId, target: 'user', userIds, count, granted: grantedTotal,
        skipped, created_at: now,
      },
    });
    return { ok: true, target: 'user', userIds, granted: grantedTotal, skipped };
  }

  // target === 'all'：以 _id 游标分批遍历全量用户
  let grantedTotal = 0;
  let processed = 0;
  let skipped = 0;
  let lastId = '';
  while (true) {
    let query = {};
    if (lastId) query._id = _.gt(lastId);
    const res = await db.collection('users')
      .where(query).orderBy('_id', 'asc').limit(BATCH).get();
    const users = res.data || [];
    if (users.length === 0) break;
    for (const u of users) {
      processed += 1;
      const g = await grantToUser(u._id, count, now, expireAt);
      grantedTotal += g;
      if (g === 0) skipped += 1;
      lastId = u._id;
    }
    if (users.length < BATCH) break;
  }
  await db.collection('makeup_card_grant').add({
    data: {
      operatorId, target: 'all', count, granted: grantedTotal,
      processed, skipped, created_at: now,
    },
  });
  return { ok: true, target: 'all', count, granted: grantedTotal, processed, skipped };
};
