// cloudfunctions/signin/index.js - 每日签到 / 周期奖励 / 补签卡
// 所有时间判断均使用服务器时间（Asia/Shanghai）
// 签到周期：88天；断签或满88天重开周期
// 奖励：首签+5（一次）、常规奖励（第7天起每3天，阶梯1/2/3）、目标奖励（88天，25起每轮+5）
// 补签卡：10积分/张，每月1-10号可兑换，月限5张；补签范围过去30天，连补最多3天，从最早漏签开始
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const TZ_OFFSET = 8 * 60 * 60 * 1000;   // 东八区
const DAY_MS = 24 * 60 * 60 * 1000;

// 签到周期
const CYCLE_DAYS = 88;
// 补签卡
const CARD_EXPIRE_DAYS = 30;
const CARD_HOLD_LIMIT = 10;
const EXCHANGE_COST = 10;
const EXCHANGE_MONTH_LIMIT = 5;
const EXCHANGE_DAY_FROM = 1;   // 每月可兑换起始日
const EXCHANGE_DAY_TO = 10;    // 每月可兑换截止日
const MAKEUP_WINDOW_DAYS = 30; // 补签范围（过去N天）
const MAKEUP_MAX_CONSECUTIVE = 3; // 连补最多天数
// 奖励
const FIRST_SIGN_POINTS = 5;   // 首签奖励
const GOAL_BASE_POINTS = 25;   // 首轮目标奖励
const GOAL_STEP_POINTS = 5;    // 每轮递增
const REGULAR_START_DAY = 7;   // 常规奖励起始连续天数
const REGULAR_INTERVAL = 3;    // 每3天一次
const POINTS_EXPIRE_DAYS = 365;

// ---------- 日期工具 ----------
function fmtDate(d) {
  const t = new Date(d.getTime() + TZ_OFFSET);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
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
// 两个日期字符串相差的天数（a - b）
function diffDays(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / DAY_MS);
}

async function ensureCollections() {
  const names = ['user_signin', 'signin_detail', 'makeup_card', 'score_exchange'];
  for (const n of names) {
    try { await db.createCollection(n); } catch (e) { /* 已存在忽略 */ }
  }
}

async function getUserIdByOpenid(openid) {
  if (!openid) return '';
  const res = await db.collection('users').where({ _openid: openid }).limit(1).get();
  if (res.data && res.data.length > 0) return res.data[0]._id;
  const res2 = await db.collection('users').where({ openid }).limit(1).get();
  return res2.data && res2.data.length > 0 ? res2.data[0]._id : '';
}

async function getOrCreateSignin(userId) {
  try {
    const res = await db.collection('user_signin').doc(userId).get();
    return res.data;
  } catch (e) {
    const now = new Date();
    const doc = {
      userId,
      total_score: 0,
      continuous_days: 0,
      last_sign_date: '',
      max_continuous_days: 0,
      cycle_start_date: '',     // 当前周期开始日期
      cycle_count: 0,           // 已完成周期数
      first_sign_done: false,   // 是否已领首签奖励
      last_regular_reward_day: 0, // 上次领取常规奖励的连续天数
      updated_at: now,
      createTime: now,
    };
    try { await db.collection('user_signin').doc(userId).set({ data: doc }); } catch (e2) { /* 并发忽略 */ }
    return doc;
  }
}

// 常规奖励积分（按连续天数阶梯）
function regularPoints(continuousDays) {
  if (continuousDays < 30) return 1;
  if (continuousDays < 60) return 2;
  return 3;
}

// 当前连续天数是否应触发常规奖励（第7天起，每3天一次）
function shouldRegularReward(continuousDays) {
  if (continuousDays < REGULAR_START_DAY) return false;
  return (continuousDays - REGULAR_START_DAY) % REGULAR_INTERVAL === 0;
}

// 目标奖励积分（按已完成轮次）
function goalPoints(cycleCount) {
  return GOAL_BASE_POINTS + cycleCount * GOAL_STEP_POINTS;
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

  const cards = await db.collection('makeup_card')
    .where({ userId, status: 0, expire_at: _.gt(now) })
    .orderBy('expire_at', 'asc').get();
  const usableCount = (cards.data || []).length;
  const expiringCount = (cards.data || []).filter(c =>
    new Date(c.expire_at) <= new Date(now.getTime() + 3 * DAY_MS)).length;

  const signed = signin.last_sign_date === todayStr;
  const continuous = signin.continuous_days || 0;

  // 周期信息
  let cycleStart = signin.cycle_start_date || '';
  let cycleProgress = 0;
  if (cycleStart) {
    cycleProgress = diffDays(todayStr, cycleStart) + 1;
    if (cycleProgress < 0) cycleProgress = 0;
    if (cycleProgress > CYCLE_DAYS) cycleProgress = CYCLE_DAYS;
  }

  // 可补签的漏签日（过去30天内，属于当前周期，从最早开始）
  const makeupDays = await calcMakeupDays(userId, signin, todayStr, now);

  // 今日签到预览
  let nextContinuous;
  if (signed) {
    nextContinuous = continuous;
  } else if (signin.last_sign_date === yesterdayStr) {
    nextContinuous = continuous + 1;
  } else {
    nextContinuous = 1; // 断签重开
  }

  // 本月兑换
  const month = fmtMonth(now);
  const exRes = await db.collection('score_exchange')
    .where({ userId, exchange_type: 1, month }).get();
  const monthUsed = (exRes.data || []).reduce((s, r) => s + (r.quantity || 0), 0);

  // 本月签到明细（日历）
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

  const today = parseInt(todayStr.split('-')[2], 10);
  const inExchangeWindow = today >= EXCHANGE_DAY_FROM && today <= EXCHANGE_DAY_TO;

  return {
    ok: true,
    signed,
    today: todayStr,
    yesterday: yesterdayStr,
    continuous_days: continuous,
    max_continuous_days: signin.max_continuous_days || 0,
    last_sign_date: signin.last_sign_date,
    cycle_days: CYCLE_DAYS,
    cycle_progress: cycleProgress,
    cycle_start_date: cycleStart,
    cycle_count: signin.cycle_count || 0,
    first_sign_done: !!signin.first_sign_done,
    next_continuous: nextContinuous,
    preview: {
      base: 1,
      bonus: signed ? 0 : calcTodayBonus(nextContinuous, signin),
      total: signed ? 0 : 1 + calcTodayBonus(nextContinuous, signin),
    },
    // 距下次常规奖励
    next_regular: nextRegularInfo(nextContinuous),
    // 距目标奖励
    next_goal: { gap: Math.max(0, CYCLE_DAYS - cycleProgress), points: goalPoints(signin.cycle_count || 0) },
    can_makeup: makeupDays.length > 0 ? 1 : 0,
    makeup_days: makeupDays,
    usable_cards: usableCount,
    expiring_cards: expiringCount,
    balance,
    exchange: {
      month, used: monthUsed, limit: EXCHANGE_MONTH_LIMIT, cost: EXCHANGE_COST,
      in_window: inExchangeWindow, day_from: EXCHANGE_DAY_FROM, day_to: EXCHANGE_DAY_TO,
    },
    signed_dates: signedDates,
    makeup_dates: makeupDates,
    hold_limit: CARD_HOLD_LIMIT,
    first_sign_points: FIRST_SIGN_POINTS,
  };
}

// 计算今日签到可得的 bonus（不含基础分），用于预览
function calcTodayBonus(nextContinuous, signin) {
  let bonus = 0;
  if (!signin.first_sign_done) bonus += FIRST_SIGN_POINTS;
  if (shouldRegularReward(nextContinuous)) bonus += regularPoints(nextContinuous);
  if (nextContinuous === CYCLE_DAYS) bonus += goalPoints(signin.cycle_count || 0);
  return bonus;
}

function nextRegularInfo(continuousDays) {
  if (continuousDays < REGULAR_START_DAY) {
    return { gap: REGULAR_START_DAY - continuousDays, points: regularPoints(REGULAR_START_DAY), desc: `再签 ${REGULAR_START_DAY - continuousDays} 天开启常规奖励` };
  }
  const sinceStart = continuousDays - REGULAR_START_DAY;
  const step = REGULAR_INTERVAL - (sinceStart % REGULAR_INTERVAL);
  if (step === REGULAR_INTERVAL) {
    return { gap: 0, points: regularPoints(continuousDays + REGULAR_INTERVAL), desc: '今日签到可领常规奖励' };
  }
  return { gap: step, points: regularPoints(continuousDays + step), desc: `再签 ${step} 天可领常规奖励` };
}

// 计算可补签的漏签日列表（过去30天内、当前周期内、按时间正序）
async function calcMakeupDays(userId, signin, todayStr, now) {
  const cycleStart = signin.cycle_start_date || '';
  if (!cycleStart) return [];

  const fromDate = addDays(todayStr, -MAKEUP_WINDOW_DAYS);
  // 查询最近30天的签到明细
  const detRes = await db.collection('signin_detail')
    .where({ userId, sign_date: _.gte(fromDate).and(_.lte(todayStr)) })
    .field({ sign_date: true }).get();
  const signedSet = new Set((detRes.data || []).map(d => d.sign_date));

  const makeupDays = [];
  // 从周期开始日遍历到昨天，找漏签日（且在过去30天内）
  let day = cycleStart;
  const yesterday = addDays(todayStr, -1);
  while (day <= yesterday) {
    const in30 = diffDays(todayStr, day) <= MAKEUP_WINDOW_DAYS;
    if (in30 && !signedSet.has(day)) {
      makeupDays.push(day);
    }
    day = addDays(day, 1);
    if (diffDays(day, cycleStart) > CYCLE_DAYS) break;
  }
  // 从最早开始，最多取 MAX 个
  return makeupDays.slice(0, MAKEUP_MAX_CONSECUTIVE);
}

// ---------- action: sign ----------
async function actionSign(event, openid) {
  const userId = await getUserIdByOpenid(openid);
  if (!userId) return { ok: false, code: 'NO_USER', msg: '用户不存在' };
  const now = new Date();
  const todayStr = fmtDate(now);
  const yesterdayStr = addDays(todayStr, -1);

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
      signin = { total_score: 0, continuous_days: 0, last_sign_date: '', max_continuous_days: 0, cycle_start_date: '', cycle_count: 0, first_sign_done: false, last_regular_reward_day: 0 };
    }
    if (signin.last_sign_date === todayStr) {
      await transaction.rollback();
      return { ok: false, code: 'ALREADY', msg: '今日已签到' };
    }

    let continuous = parseInt(signin.continuous_days, 10) || 0;
    let cycleStart = signin.cycle_start_date || '';
    let cycleCount = parseInt(signin.cycle_count, 10) || 0;
    let firstSignDone = !!signin.first_sign_done;
    let lastRegularDay = parseInt(signin.last_regular_reward_day, 10) || 0;
    let isContinuous = false;

    // 判断是否连续
    if (signin.last_sign_date === yesterdayStr) {
      // 昨天签了，连续 +1
      continuous += 1;
      isContinuous = true;
      if (!cycleStart) cycleStart = addDays(todayStr, -(continuous - 1));
    } else {
      // 断签，重开周期
      continuous = 1;
      cycleStart = todayStr;
      isContinuous = false;
    }

    // 若连续满88天，先发目标奖励，再开新周期
    let goalReward = 0;
    if (continuous >= CYCLE_DAYS) {
      goalReward = goalPoints(cycleCount);
      // 发完目标奖励后重开周期
      cycleCount += 1;
      continuous = 1;
      cycleStart = todayStr;
    }

    // 计算奖励
    let base = 1;
    let firstReward = 0;
    let regularReward = 0;

    // 首签奖励（全账号仅一次）
    if (!firstSignDone) {
      firstReward = FIRST_SIGN_POINTS;
      firstSignDone = true;
    }
    // 常规奖励
    if (shouldRegularReward(continuous) && continuous > lastRegularDay) {
      regularReward = regularPoints(continuous);
      lastRegularDay = continuous;
    }

    const bonus = firstReward + regularReward + goalReward;
    const total = base + bonus;

    // 写签到明细
    await transaction.collection('signin_detail').add({
      data: {
        userId, sign_date: todayStr,
        score_earned: total, base_score: base, bonus_score: bonus,
        is_continuous: isContinuous ? 1 : 0, is_makeup: 0,
        first_reward: firstReward, regular_reward: regularReward, goal_reward: goalReward,
        created_at: now,
      },
    });
    if (total > 0) {
      await transaction.collection('points_records').add({
        data: {
          userId, type: 'earn', category: '签到', points: total,
          description: buildDesc(continuous, firstReward, regularReward, goalReward),
          status: 'approved', images: [],
          earnDate: now, expireDate: new Date(now.getTime() + POINTS_EXPIRE_DAYS * DAY_MS),
          createTime: now,
        },
      });
    }

    const maxCont = Math.max(signin.max_continuous_days || 0, continuous);
    await transaction.collection('user_signin').doc(userId).update({
      data: {
        last_sign_date: todayStr,
        continuous_days: continuous,
        max_continuous_days: maxCont,
        cycle_start_date: cycleStart,
        cycle_count: cycleCount,
        first_sign_done: firstSignDone,
        last_regular_reward_day: lastRegularDay,
        total_score: _.inc(total),
        updated_at: now,
      },
    });
    await transaction.collection('users').doc(userId).update({
      data: { points: _.inc(total) },
    });

    await transaction.commit();
    return {
      ok: true, earned: total, base, bonus, continuous,
      first_reward: firstReward, regular_reward: regularReward, goal_reward: goalReward,
      cycle_count: cycleCount, today: todayStr,
      max_continuous_days: maxCont,
    };
  } catch (err) {
    try { await transaction.rollback(); } catch (e) { /* 忽略 */ }
    console.error('sign error', err);
    return { ok: false, code: 'CONFLICT', msg: '签到处理中，请勿重复操作' };
  }
}

function buildDesc(continuous, firstReward, regularReward, goalReward) {
  const parts = [`每日签到（连续第${continuous}天）`];
  if (firstReward > 0) parts.push(`首签奖励+${firstReward}`);
  if (regularReward > 0) parts.push(`常规奖励+${regularReward}`);
  if (goalReward > 0) parts.push(`目标奖励+${goalReward}`);
  return parts.join('；');
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
      ...c, status,
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
  const today = parseInt(fmtDate(now).split('-')[2], 10);

  // 兑换窗口：每月1-10号
  if (today < EXCHANGE_DAY_FROM || today > EXCHANGE_DAY_TO) {
    return { ok: false, code: 'NOT_IN_WINDOW', msg: `补签卡仅限每月 ${EXCHANGE_DAY_FROM}-${EXCHANGE_DAY_TO} 号兑换` };
  }

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

    // 持有上限
    const cardsRes = await transaction.collection('makeup_card').where({ userId, status: 0 }).get();
    const usableCount = (cardsRes.data || []).filter(c => new Date(c.expire_at) > now).length;
    if (usableCount >= CARD_HOLD_LIMIT) {
      await transaction.rollback();
      return { ok: false, code: 'HOLD_LIMIT', msg: `补签卡持有已达上限（${CARD_HOLD_LIMIT} 张）` };
    }

    const exRes = await transaction.collection('score_exchange')
      .where({ userId, exchange_type: 1, month }).get();
    const monthUsed = (exRes.data || []).reduce((s, r) => s + (r.quantity || 0), 0);
    if (monthUsed >= EXCHANGE_MONTH_LIMIT) {
      await transaction.rollback();
      return { ok: false, code: 'MONTH_LIMIT', msg: `本月兑换已达上限（${EXCHANGE_MONTH_LIMIT} 张）` };
    }

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
    return { ok: true, usable_cards: usableCount + 1, balance: balance - EXCHANGE_COST, month_used: monthUsed + 1 };
  } catch (err) {
    try { await transaction.rollback(); } catch (e) { /* 忽略 */ }
    console.error('exchange error', err);
    return { ok: false, code: 'ERROR', msg: '兑换失败，请稍后重试' };
  }
}

// ---------- action: useCard ----------
// 补签：从最早漏签日开始，连补最多3天
async function actionUseCard(event, openid) {
  const userId = await getUserIdByOpenid(openid);
  if (!userId) return { ok: false, code: 'NO_USER', msg: '用户不存在' };
  const cardId = event.cardId;
  if (!cardId) return { ok: false, code: 'NO_CARD', msg: '补签卡不存在' };
  const now = new Date();
  const todayStr = fmtDate(now);

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
      signin = { continuous_days: 0, last_sign_date: '', cycle_start_date: '' };
    }

    // 计算可补签的漏签日
    const makeupDays = await calcMakeupDaysTxn(transaction, userId, signin, todayStr, now);
    if (makeupDays.length === 0) {
      await transaction.rollback();
      return { ok: false, code: 'NO_MAKEUP_DAY', msg: '没有可补签的漏签日' };
    }

    // 补签最早的一天
    const targetDate = makeupDays[0];
    const base = 1;

    await transaction.collection('makeup_card').doc(cardId).update({
      data: { status: 1, used_at: now },
    });
    await transaction.collection('signin_detail').add({
      data: {
        userId, sign_date: targetDate,
        score_earned: base, base_score: base, bonus_score: 0,
        is_continuous: 0, is_makeup: 1, created_at: now,
      },
    });
    await transaction.collection('points_records').add({
      data: {
        userId, type: 'earn', category: '签到', points: base,
        description: `补签（${targetDate}）`, status: 'approved', images: [],
        earnDate: now, expireDate: new Date(now.getTime() + POINTS_EXPIRE_DAYS * DAY_MS),
        createTime: now,
      },
    });
    await transaction.collection('users').doc(userId).update({
      data: { points: _.inc(base) },
    });

    // 补签不影响 last_sign_date / continuous_days（只是补齐历史）
    await transaction.collection('user_signin').doc(userId).update({
      data: { total_score: _.inc(base), updated_at: now },
    });

    await transaction.commit();
    const usable = await countUsableCards(userId, now);
    return { ok: true, base, makeup_date: targetDate, usable_cards: usable };
  } catch (err) {
    try { await transaction.rollback(); } catch (e) { /* 忽略 */ }
    console.error('useCard error', err);
    return { ok: false, code: 'ERROR', msg: '补签失败，请稍后重试' };
  }
}

async function calcMakeupDaysTxn(transaction, userId, signin, todayStr, now) {
  const cycleStart = signin.cycle_start_date || '';
  if (!cycleStart) return [];
  const fromDate = addDays(todayStr, -MAKEUP_WINDOW_DAYS);
  const detRes = await transaction.collection('signin_detail')
    .where({ userId, sign_date: _.gte(fromDate).and(_.lte(todayStr)) })
    .field({ sign_date: true }).get();
  const signedSet = new Set((detRes.data || []).map(d => d.sign_date));

  const days = [];
  let day = cycleStart;
  const yesterday = addDays(todayStr, -1);
  while (day <= yesterday) {
    const in30 = diffDays(todayStr, day) <= MAKEUP_WINDOW_DAYS;
    if (in30 && !signedSet.has(day)) days.push(day);
    day = addDays(day, 1);
    if (diffDays(day, cycleStart) > CYCLE_DAYS) break;
  }
  return days.slice(0, MAKEUP_MAX_CONSECUTIVE);
}

async function countUsableCards(userId, now) {
  const res = await db.collection('makeup_card')
    .where({ userId, status: 0, expire_at: _.gt(now) }).count();
  return res.total;
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
