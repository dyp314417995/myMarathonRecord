// cloudfunctions/raceReviewRemind - 每天 20:00 定时触发
//
// 赛事完赛「第二天」给关注了该赛事的人推一条待评价提醒。
// 关注者 = race_markers 里标记过该赛事的人（想去 / 已参加），当天已写过评价的不打扰。
//
// 沿用 raceQrExpireNotify 的做法：
//   - 用 race_review_remind_log 按天去重，防止重复触发重复打扰
//   - 通过 sendSubscribeMsg 云函数发送（需要用户此前订阅过该模板）
//   - 43101 = 用户没有订阅额度（未订阅过），只在日志里记下，不算失败
const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d5gy0iuiba5f9300f' });
const db = cloud.database();
const _ = db.command;

// 通用赛事提醒模板（详情页/日历页已引导用户订阅过）
const TEMPLATE_ID = 'xepY9QmUT4YPXUt7mLhQrtlVBcN01eGkk-NqH0Av5Ew';

const pad = (n) => String(n).padStart(2, '0');
const bjNow = () => new Date(Date.now() + 8 * 3600 * 1000);
const dayStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayKey = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
const truncate = (s, n) => {
  const v = String(s || '');
  return v.length > n ? v.slice(0, n - 1) + '…' : v;
};

exports.main = async () => {
  const now = bjNow();
  const yesterday = new Date(now.getTime() - 86400000);
  const yStr = dayStr(yesterday);
  const key = dayKey(now);

  // 0. 当天已跑过则跳过（云函数可能因重试被调用多次）
  const flag = await db.collection('race_review_remind_log').where({ dayKey: key }).count().catch(() => null);
  if (flag && flag.total > 0) return { success: true, deduped: true, date: yStr };

  // 1. 昨天完赛的赛事
  // race_events.date 是日期类型（读出形如 2027-05-16T00:00:00.000Z），并非字符串，
  // 既不能精确匹配 'YYYY-MM-DD'，也吃不到字符串正则；必须按 [当天 00:00Z, 次日 00:00Z) 区间查。
  const yStart = new Date(yStr + 'T00:00:00.000Z');
  const yEnd = new Date(yStart.getTime() + 86400000);
  const evRes = await db.collection('race_events')
    .where({ date: _.gte(yStart), date: _.lt(yEnd) })
    .limit(200).get().catch(() => null);
  const events = (evRes && evRes.data) || [];

  // ⚠️ 已知数据情况：历史赛事（多为 2024 年）的 date 被统一写成了导入当天，
  // 于是「昨天的赛事」可能一次涌出上百条。这里做两件事：
  //   1) 只处理有人关注的赛事（markers > 0 才可能推送）
  //   2) 关注者与已评价名单按赛事一次批量取，避免逐条赛事查库
  const eventIds = events.map(e => e._id);
  const markerMap = {};
  const reviewedMap = {};
  if (eventIds.length) {
    const chunk = (arr, size) => {
      const out = [];
      for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
      return out;
    };
    for (const ids of chunk(eventIds, 20)) {
      const mk = await db.collection('race_markers').where({ eventId: _.in(ids) }).limit(1000).get().catch(() => null);
      for (const m of ((mk && mk.data) || [])) {
        if (!m.userId) continue;
        (markerMap[m.eventId] = markerMap[m.eventId] || []).push(m.userId);
      }
      const rv = await db.collection('race_reviews').where({ eventId: _.in(ids) }).limit(1000).get().catch(() => null);
      for (const r of ((rv && rv.data) || [])) {
        if (!r.userId) continue;
        (reviewedMap[r.eventId] = reviewedMap[r.eventId] || new Set()).add(r.userId);
      }
    }
  }

  let sentCount = 0, noQuota = 0, skippedReviewed = 0, detail = [];
  const noQuotaUsers = new Set();
  let yearStat = {};

  for (const ev of events) {
    const year = new Date(ev.date).toISOString().slice(0, 4);
    yearStat[year] = (yearStat[year] || 0) + 1;
    const marked = markerMap[ev._id] || [];
    if (!marked.length) continue;   // 没人关注，跳过（不进日志）

    const reviewed = reviewedMap[ev._id] || new Set();
    const targets = marked.filter(uid => !reviewed.has(uid));
    skippedReviewed += marked.length - targets.length;
    if (!targets.length) {
      detail.push({ event: truncate(ev.name, 20), status: '已全部评价', markers: marked.length });
      continue;
    }

    // 取 openid（一次批量）
    const openidMap = {};
    for (const uid of targets) {
      const uRes = await db.collection('users').doc(uid).get().catch(() => null);
      const u = uRes && uRes.data;
      const openid = u && (u.openid || u._openid);
      if (openid) openidMap[uid] = openid;
    }

    // 逐个推送（点击直接进入该赛事的评价页）
    const page = `/pages/tools/calendar/review?eventId=${ev._id}`;
    const msgData = {
      date1: { value: yStr },
      thing2: { value: truncate(`${ev.name} 待评价`, 19) },
      time3: { value: yStr },
    };

    let ok = 0;
    for (const uid of targets) {
      const openid = openidMap[uid];
      if (!openid || noQuotaUsers.has(uid)) continue;
      try {
        const res = await cloud.callFunction({
          name: 'sendSubscribeMsg',
          data: { openid, templateId: TEMPLATE_ID, page, data: msgData },
        });
        if (res && res.result && res.result.ok) {
          sentCount++; ok++;
        } else if (res && res.result && /43101/.test(res.result.error || '')) {
          noQuota++; noQuotaUsers.add(uid);
        }
      } catch (err) {
        console.warn('review remind send fail', err.message);
      }
    }
    detail.push({ event: truncate(ev.name, 20), status: ok > 0 ? 'sent' : 'no_send', markers: marked.length, targets: targets.length });
  }

  // 5. 写去重日志（即使当天没有赛事也写，表示已跑到）
  await db.collection('race_review_remind_log').add({
    data: {
      dayKey: key, date: yStr,
      eventCount: events.length, markedCount: detail.length,
      sentCount, noQuota, skippedReviewed,
      yearStat,   // 便于观察「历史赛事日期被写成导入当天」这批脏数据的影响
      detail: detail.slice(0, 20), createTime: new Date(),
    },
  }).catch(() => {});

  return {
    success: true, date: yStr,
    eventCount: events.length, markedCount: detail.length,
    sentCount, noQuota, skippedReviewed, yearStat, detail: detail.slice(0, 20),
  };
};
