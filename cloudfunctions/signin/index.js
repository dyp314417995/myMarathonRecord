// cloudfunctions/signin/index.js - 每日签到 / 连续奖励 / 补签卡
// 所有时间判断均使用服务器时间（Asia/Shanghai），客户端时间仅用于展示，防篡改/防刷
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const TZ_OFFSET = 8 * 60 * 60 * 1000;   // 东八区
const DAY_MS = 24 * 60 * 60 * 1000;
const CARD_EXPIRE_DAYS = 30;            // 补签卡有效期（天）
const CARD_HOLD_LIMIT = 10;             // 补签卡持有上限
const EXCHANGE_COST = 30;               // 兑换一张补签卡所需积分
const EXCHANGE_MONTH_LIMIT = 3;         // 每月兑换上限（张）
const RULE_NAME = '签到';               // 积分规则名称（积分值由超管在「积分规则」中配置）
const POINTS_EXPIRE_DAYS = 365;         // 签到积分有效期（与现有积分体系保持一致）

// ---------- 上海时区日期工具 ----------
function fmtDate(d) {
  const t = new Date(d.getTime() + TZ_OFFSET);
  const y = t.getUTCFullYear();
  const m = String(t.getUTCMonth() + 1).padStart(2, '0');
  const day = String(t.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function fmtMonth(d) {
  const t = new Date(d.getTime() + TZ_OFFSET);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
}
function addDays(dateStr, delta) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const utc = Date.UTC(y, m - 1, d) + delta * DAY_MS;
  return fmtDate(new Date(utc - TZ_OFFSET));
}

// ---------- 工具函数 ----------
async function getUserIdByOpenid(openid) {
  if (!openid) return '';
  const res = await db.collection('users').where({ _openid: openid }).limit(1).get();
  if (res.data && res.data.length > 0) return res.data[0]._id;
  // 兼容显式 openid 字段
  const res2 = await db.collection('users').where({ openid }).limit(1).get();
  return res2.data && res2.data.length > 0 ? res2.data[0]._id : '';
}

/** 确保签到相关集合存在（首次部署自动建集合，幂等） */
async function ensureCollections() {
  const names = ['user_signin', 'signin_detail', 'makeup_card', 'score_exchange'];
  for (const n of names) {
    try { await db.createCollection(n); } catch (e) { /* 已存在则忽略 */ }
  }
}
/** 读取「签到」积分规则：仅「启用」时发分，禁用/删除/未配置一律 0 分 */
async function getSigninRule() {
  try {
    const res = await db.collection('points_rules')
      .where({ name: RULE_NAME }).limit(1).get();
    if (res.data && res.data.length > 0) {
      const rule = res.data[0];
      // 仅「启用」的规则发分；禁用/删除/未配置 → 0 分
      if (rule.status !== 'active') {
        return { points: 0, description: '', disabled: true };
      }
      const p = parseInt(rule.points, 10);
      if (!isNaN(p) && p > 0) {
        return { points: p, description: rule.description || '', disabled: false };
      }
    }
  } catch (e) { console.warn('getSigninRule error', e); }
  return { points: 0, description: '', disabled: true };
}

/** 获取或创建用户签到汇总（user_signin，以 userId 为主键） */
async function getOrCreateSignin(userId) {
  try {
    const res = await db.collection('user_signin').doc(userId).get();
    return res.data;
  } catch (e) {
    const now = new Date();
    const doc = {
      userId,
      total_score: 0,            // 签到累计获得积分
      continuous_days: 0,
      last_sign_date: '',        // 'YYYY-MM-DD'
      max_continuous_days: 0,
      updated_at: now,
      createTime: now,
    };
    try {
      await db.collection('user_signin').doc(userId).set({ data: doc });
    } catch (e2) { /* 并发创建冲突可忽略 */ }
    return doc;
  }
}

/** 计算连续签到额外奖励：7 的倍数 +5，30 的倍数 +20，同时命中叠加 */
function calcBonus(continuousDays) {
  let bonus = 0;
  if (continuousDays > 0 && continuousDays % 7 === 0) bonus += 5;
  if (continuousDays > 0 && continuousDays % 30 === 0) bonus += 20;
  return bonus;
}

/** 距下次额外奖励的信息 */
function rewardInfo(continuousDays) {
  if (continuousDays <= 0) return { gap: 7, bonus: 5 };
  const g7 = continuousDays % 7 === 0 ? 0 : 7 - (continuousDays % 7);
  const g30 = continuousDays % 30 === 0 ? 0 : 30 - (continuousDays % 30);
  const both = g7 === 0 && g30 === 0;
  const bonus = both ? 25 : (g7 <= g30 ? 5 : 20);
  return { gap: Math.min(g7, g30), bonus };
}

/** 统计有效（未过期）补签卡数量 */
async function countUsableCards(userId, now) {
  const t = now || new Date();
  const res = await db.collection('makeup_card')
    .where({ userId, status: 0, expire_at: _.gt(t) }).count();
  return res.total;
}

/** 事务内统计有效补签卡数量（兼容事务查询，用 get + JS 过滤） */
async function countUsableInTxn(transaction, userId, now) {
  const res = await transaction.collection('makeup_card')
    .where({ userId, status: 0 }).get();
  return (res.data || []).filter(c => new Date(c.expire_at) > now).length;
}

function sourceText(source) {
  return { 1: '注册赠送', 2: '连续签到奖励', 3: '积分兑换', 4: '运营活动' }[source] || '未知来源';
}
function statusText(status) {
  return { 0: '可使用', 1: '已使用', 2: '已过期' }[status] || '未知';
}

// ---------- action: info ----------
async function actionInfo(event, openid) {
  const userId = await getUserIdByOpenid(openid);
  if (!userId) return { ok: false, code: 'NO_USER', msg: '用户不存在' };

  const signin = await getOrCreateSignin(userId);
  const now = new Date();
  const todayStr = fmtDate(now);
  const yesterdayStr = addDays(todayStr, -1);
  const dayBeforeStr = addDays(todayStr, -2);
  const rule = await getSigninRule();
  const base = rule.points;

  // 有效补签卡 + 临期（3 天内）数量
  const cards = await db.collection('makeup_card')
    .where({ userId, status: 0, expire_at: _.gt(now) })
    .orderBy('expire_at', 'asc').get();
  const usableCount = (cards.data || []).length;
  const expiringCount = (cards.data || []).filter(c =>
    new Date(c.expire_at) <= new Date(now.getTime() + 3 * DAY_MS)).length;

  const signed = signin.last_sign_date === todayStr;
  const canMakeup = !signed && signin.last_sign_date === dayBeforeStr && usableCount > 0;

  // 今日签到预览（未签到时按最优路径预估：可补签则视为连续）
  let nextContinuous;
  if (signed) {
    nextContinuous = signin.continuous_days || 0;
  } else if (signin.last_sign_date === yesterdayStr || canMakeup) {
    nextContinuous = (signin.continuous_days || 0) + 1;
  } else {
    nextContinuous = 1;
  }
  const previewBonus = rule.disabled ? 0 : (signed ? 0 : calcBonus(nextContinuous));
  const reward = rule.disabled ? { gap: 0, bonus: 0 } : rewardInfo(nextContinuous);

  // 本月兑换次数
  const month = fmtMonth(now);
  const exRes = await db.collection('score_exchange')
    .where({ userId, exchange_type: 1, month }).get();
  const monthUsed = (exRes.data || []).reduce((s, r) => s + (r.quantity || 0), 0);

  // 本月签到明细（日历用）
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-31`;
  const detRes = await db.collection('signin_detail')
    .where({ userId, sign_date: _.gte(monthStart).and(_.lte(monthEnd)) })
    .field({ sign_date: true, is_makeup: true }).get();
  const signedDates = [];
  const makeupDates = [];
  (detRes.data || []).forEach(d => {
    if (d.is_makeup) makeupDates.push(d.sign_date);
    signedDates.push(d.sign_date);
  });

  let balance = 0;
  try {
    const u = await db.collection('users').doc(userId).get();
    balance = u.data.points || 0;
  } catch (e) { /* 忽略 */ }

  return {
    ok: true,
    signed,
    today: todayStr,
    yesterday: yesterdayStr,
    continuous_days: signin.continuous_days || 0,
    max_continuous_days: signin.max_continuous_days || 0,
    last_sign_date: signin.last_sign_date,
    base_points: base,
    rule_disabled: !!rule.disabled,
    rule_description: rule.disabled ? '签到积分规则已停用，签到不再获得积分' : rule.description,
    preview: { base, bonus: previewBonus, total: signed ? 0 : base + previewBonus },
    reward,
    can_makeup: canMakeup ? 1 : 0,
    usable_cards: usableCount,
    expiring_cards: expiringCount,
    balance,
    exchange: { month, used: monthUsed, limit: EXCHANGE_MONTH_LIMIT, cost: EXCHANGE_COST },
    signed_dates: signedDates,
    makeup_dates: makeupDates,
    hold_limit: CARD_HOLD_LIMIT,
  };
}

// ---------- action: sign ----------
async function actionSign(event, openid) {
  const userId = await getUserIdByOpenid(openid);
  if (!userId) return { ok: false, code: 'NO_USER', msg: '用户不存在' };
  const useCard = event.useCard === true;
  const rule = await getSigninRule();
  const base = rule.points;
  const now = new Date();
  const todayStr = fmtDate(now);
  const yesterdayStr = addDays(todayStr, -1);
  const dayBeforeStr = addDays(todayStr, -2);

  // 事务外快速拦截：今日已签到
  const signin0 = await getOrCreateSignin(userId);
  if (signin0.last_sign_date === todayStr) {
    return { ok: false, code: 'ALREADY', msg: '今日已签到' };
  }

  const transaction = await db.startTransaction();
  try {
    let signin;
    try {
      signin = (await transaction.collection('user_signin').doc(userId).get()).data;
    } catch (e) {
      signin = { total_score: 0, continuous_days: 0, last_sign_date: '', max_continuous_days: 0 };
    }

    // 事务内再次校验，防并发重复签到
    if (signin.last_sign_date === todayStr) {
      await transaction.rollback();
      return { ok: false, code: 'ALREADY', msg: '今日已签到' };
    }

    let continuous = parseInt(signin.continuous_days, 10) || 0;
    let isContinuous = false;
    let makeupUsed = false;
    let usedCardId = null;

    if (signin.last_sign_date === yesterdayStr) {
      // 昨天已签：连续 +1
      continuous += 1;
      isContinuous = true;
    } else if (signin.last_sign_date === dayBeforeStr) {
      // 仅昨天断签：可补签
      const cardsRes = await transaction.collection('makeup_card')
        .where({ userId, status: 0 }).limit(20).get();
      const cards = (cardsRes.data || [])
        .filter(c => new Date(c.expire_at) > now)
        .sort((a, b) => new Date(a.expire_at) - new Date(b.expire_at));
      const card = cards[0];
      const cardValid = !!card;
      if (cardValid && useCard) {
        // 消耗补签卡补昨天：+基础分，连续天数不变；随后今天签到仍为连续
        makeupUsed = true;
        usedCardId = card._id;
        await transaction.collection('makeup_card').doc(card._id).update({
          data: { status: 1, used_at: now },
        });
        await transaction.collection('signin_detail').add({
          data: {
            userId, sign_date: yesterdayStr,
            score_earned: base, base_score: base, bonus_score: 0,
            is_continuous: 0, is_makeup: 1, created_at: now,
          },
        });
        if (base > 0) {
          await transaction.collection('points_records').add({
            data: {
              userId, type: 'earn', category: RULE_NAME, points: base,
              description: '补签（昨天）', status: 'approved', images: [],
              earnDate: now, expireDate: new Date(now.getTime() + POINTS_EXPIRE_DAYS * DAY_MS),
              createTime: now,
            },
          });
        }
        continuous += 1;
        isContinuous = true;
      } else {
        continuous = 1;
      }
    } else {
      continuous = 1;
    }

    // 规则停用时积分置 0（含连续奖励），签到记录仍保留
    const bonus = rule.disabled ? 0 : calcBonus(continuous);
    const total = base + bonus;
    const desc = isContinuous ? `每日签到（连续第${continuous}天）` : '每日签到';

    // 今日签到明细（始终记录）
    await transaction.collection('signin_detail').add({
      data: {
        userId, sign_date: todayStr,
        score_earned: total, base_score: base, bonus_score: bonus,
        is_continuous: isContinuous ? 1 : 0, is_makeup: 0, created_at: now,
      },
    });
    if (total > 0) {
      await transaction.collection('points_records').add({
        data: {
          userId, type: 'earn', category: RULE_NAME, points: total,
          description: desc, status: 'approved', images: [],
          earnDate: now, expireDate: new Date(now.getTime() + POINTS_EXPIRE_DAYS * DAY_MS),
          createTime: now,
        },
      });
    }

    const earned = total + (makeupUsed ? base : 0);
    const maxCont = Math.max(signin.max_continuous_days || 0, continuous);

    // 更新签到汇总 + 用户积分余额
    await transaction.collection('user_signin').doc(userId).update({
      data: {
        last_sign_date: todayStr,
        continuous_days: continuous,
        max_continuous_days: maxCont,
        total_score: _.inc(earned),
        updated_at: now,
      },
    });
    await transaction.collection('users').doc(userId).update({
      data: { points: _.inc(earned) },
    });

    // 连续签到满 7 天（7 的倍数）里程碑：赠送 1 张补签卡（持有 < 上限时）
    let cardGranted = 0;
    if (continuous > 0 && continuous % 7 === 0) {
      const hold = await countUsableInTxn(transaction, userId, now);
      if (hold < CARD_HOLD_LIMIT) {
        await transaction.collection('makeup_card').add({
          data: {
            userId, source: 2,
            expire_at: new Date(now.getTime() + CARD_EXPIRE_DAYS * DAY_MS),
            status: 0, used_at: null, created_at: now,
          },
        });
        cardGranted = 1;
      }
    }

    await transaction.commit();
    const usable = await countUsableCards(userId, now);
    return {
      ok: true,
      earned, base, bonus, total,
      continuous,
      max_continuous_days: maxCont,
      is_makeup: makeupUsed ? 1 : 0,
      card_used: usedCardId ? 1 : 0,
      card_granted: cardGranted,
      usable_cards: usable,
      today: todayStr,
    };
  } catch (err) {
    try { await transaction.rollback(); } catch (e) { /* 忽略 */ }
    console.error('sign error', err);
    return { ok: false, code: 'CONFLICT', msg: '签到处理中，请勿重复操作' };
  }
}

// ---------- action: cards ----------
async function actionCards(event, openid) {
  const userId = await getUserIdByOpenid(openid);
  if (!userId) return { ok: false, code: 'NO_USER', msg: '用户不存在' };
  const now = new Date();
  const res = await db.collection('makeup_card')
    .where({ userId }).orderBy('created_at', 'desc').limit(100).get();
  const list = (res.data || []).map(c => {
    let status = c.status;
    if (status === 0 && new Date(c.expire_at) <= now) status = 2;
    return {
      ...c,
      status,
      source_text: sourceText(c.source),
      status_text: statusText(status),
      is_usable: status === 0,
    };
  });
  return { ok: true, list, usable: list.filter(c => c.status === 0).length };
}

// ---------- action: exchange ----------
async function actionExchange(event, openid) {
  const userId = await getUserIdByOpenid(openid);
  if (!userId) return { ok: false, code: 'NO_USER', msg: '用户不存在' };
  const now = new Date();
  const month = fmtMonth(now);

  const transaction = await db.startTransaction();
  try {
    let user;
    try {
      user = (await transaction.collection('users').doc(userId).get()).data;
    } catch (e) {
      await transaction.rollback();
      return { ok: false, code: 'NO_USER', msg: '用户不存在' };
    }
    const balance = user.points || 0;
    if (balance < EXCHANGE_COST) {
      await transaction.rollback();
      return { ok: false, code: 'NO_POINTS', msg: `积分不足，兑换需要 ${EXCHANGE_COST} 积分` };
    }

    const usableCount = await countUsableInTxn(transaction, userId, now);
    if (usableCount >= CARD_HOLD_LIMIT) {
      await transaction.rollback();
      return { ok: false, code: 'HOLD_LIMIT', msg: `补签卡持有已达上限（${CARD_HOLD_LIMIT} 张），请先使用` };
    }

    const exRes = await transaction.collection('score_exchange')
      .where({ userId, exchange_type: 1, month }).get();
    const monthUsed = (exRes.data || []).reduce((s, r) => s + (r.quantity || 0), 0);
    if (monthUsed >= EXCHANGE_MONTH_LIMIT) {
      await transaction.rollback();
      return { ok: false, code: 'MONTH_LIMIT', msg: `本月兑换已达上限（${EXCHANGE_MONTH_LIMIT} 张），下月 1 号重置` };
    }

    // 先扣积分，再发卡（同一事务，保证一致性）
    await transaction.collection('users').doc(userId).update({
      data: { points: _.inc(-EXCHANGE_COST) },
    });
    await transaction.collection('makeup_card').add({
      data: {
        userId, source: 3,
        expire_at: new Date(now.getTime() + CARD_EXPIRE_DAYS * DAY_MS),
        status: 0, used_at: null, created_at: now,
      },
    });
    await transaction.collection('score_exchange').add({
      data: {
        userId, exchange_type: 1, score_cost: EXCHANGE_COST, quantity: 1,
        month, created_at: now,
      },
    });
    await transaction.collection('points_records').add({
      data: {
        userId, type: 'use', category: '兑换补签卡', points: -EXCHANGE_COST,
        description: '积分兑换补签卡 1 张', status: 'approved', images: [],
        earnDate: now, createTime: now,
      },
    });

    await transaction.commit();
    return {
      ok: true,
      usable_cards: usableCount + 1,
      balance: balance - EXCHANGE_COST,
      month_used: monthUsed + 1,
    };
  } catch (err) {
    try { await transaction.rollback(); } catch (e) { /* 忽略 */ }
    console.error('exchange error', err);
    return { ok: false, code: 'ERROR', msg: '兑换失败，请稍后重试' };
  }
}

// ---------- action: useCard ----------
async function actionUseCard(event, openid) {
  const userId = await getUserIdByOpenid(openid);
  if (!userId) return { ok: false, code: 'NO_USER', msg: '用户不存在' };
  const cardId = event.cardId;
  if (!cardId) return { ok: false, code: 'NO_CARD', msg: '补签卡不存在' };
  const rule = await getSigninRule();
  const base = rule.points;
  const now = new Date();
  const todayStr = fmtDate(now);
  const yesterdayStr = addDays(todayStr, -1);
  const dayBeforeStr = addDays(todayStr, -2);

  const transaction = await db.startTransaction();
  try {
    let card;
    try {
      card = (await transaction.collection('makeup_card').doc(cardId).get()).data;
    } catch (e) {
      await transaction.rollback();
      return { ok: false, code: 'NO_CARD', msg: '补签卡不存在' };
    }
    if (card.userId !== userId || card.status !== 0 || new Date(card.expire_at) <= now) {
      await transaction.rollback();
      return { ok: false, code: 'CARD_INVALID', msg: '补签卡不可用或已过期' };
    }

    let signin;
    try {
      signin = (await transaction.collection('user_signin').doc(userId).get()).data;
    } catch (e) {
      signin = { continuous_days: 0, last_sign_date: '' };
    }
    // 补签资格：昨天是唯一断签日
    // ① 前天已签、昨天未签、今天未签：直接可补签昨天（补签后今天签到即连续）
    // ② 前天已签、昨天未签、今天已签：同样可补签昨天（需确认前天确有签到记录，避免无历史新用户刷分）
    let canMakeup = false;
    if (signin.last_sign_date === dayBeforeStr) {
      canMakeup = true;
    } else if (signin.last_sign_date === todayStr) {
      const dayBeforeRes = await transaction.collection('signin_detail')
        .where({ userId, sign_date: dayBeforeStr }).get();
      canMakeup = !!(dayBeforeRes.data && dayBeforeRes.data.length > 0);
    }
    if (!canMakeup) {
      await transaction.rollback();
      return { ok: false, code: 'NOT_MAKEUP_DAY', msg: '补签卡仅限补签昨天' };
    }
    // 昨天已有签到/补签记录则不可重复补签
    const dup = await transaction.collection('signin_detail')
      .where({ userId, sign_date: yesterdayStr }).get();
    if (dup.data && dup.data.length > 0) {
      await transaction.rollback();
      return { ok: false, code: 'DUP', msg: '昨天已签到，无需补签' };
    }

    await transaction.collection('makeup_card').doc(cardId).update({
      data: { status: 1, used_at: now },
    });
    await transaction.collection('signin_detail').add({
      data: {
        userId, sign_date: yesterdayStr,
        score_earned: base, base_score: base, bonus_score: 0,
        is_continuous: 0, is_makeup: 1, created_at: now,
      },
    });
    if (base > 0) {
      await transaction.collection('points_records').add({
        data: {
          userId, type: 'earn', category: RULE_NAME, points: base,
          description: '补签（昨天）', status: 'approved', images: [],
          earnDate: now, expireDate: new Date(now.getTime() + POINTS_EXPIRE_DAYS * DAY_MS),
          createTime: now,
        },
      });
      await transaction.collection('users').doc(userId).update({
        data: { points: _.inc(base) },
      });
    }
    // 补签后更新汇总：
    // - 今天未签：last_sign_date 置为昨天，今天签到即为连续（continuous_days 不变）
    // - 今天已签：last_sign_date 保持今天（避免回退导致可重复签到），连续天数补齐为「昨天+今天」=2
    const signedToday = signin.last_sign_date === todayStr;
    const newContinuous = signedToday
      ? Math.max(parseInt(signin.continuous_days, 10) || 0, 2)
      : (parseInt(signin.continuous_days, 10) || 0);
    await transaction.collection('user_signin').doc(userId).update({
      data: {
        last_sign_date: signedToday ? todayStr : yesterdayStr,
        continuous_days: newContinuous,
        max_continuous_days: Math.max(signin.max_continuous_days || 0, newContinuous),
        total_score: _.inc(base),
        updated_at: now,
      },
    });

    await transaction.commit();
    const usable = await countUsableCards(userId, now);
    return { ok: true, base, usable_cards: usable };
  } catch (err) {
    try { await transaction.rollback(); } catch (e) { /* 忽略 */ }
    console.error('useCard error', err);
    return { ok: false, code: 'ERROR', msg: '补签失败，请稍后重试' };
  }
}

// ---------- 入口 ----------
exports.main = async (event) => {
  await ensureCollections();
  const { OPENID } = cloud.getWXContext();
  const action = (event && event.action) || '';
  switch (action) {
    case 'info': return await actionInfo(event, OPENID);
    case 'sign': return await actionSign(event, OPENID);
    case 'cards': return await actionCards(event, OPENID);
    case 'exchange': return await actionExchange(event, OPENID);
    case 'useCard': return await actionUseCard(event, OPENID);
    default: return { ok: false, code: 'BAD_ACTION', msg: '未知操作' };
  }
};