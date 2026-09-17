// 云函数：fixActivityPoints - 一次性补发"集体活动"积分
// 用法：云开发 → 云函数 → fixActivityPoints → 「云端测试」面板传 JSON 即可
//
// 常用参数（event 即 JSON）：
//   { "dryRun": true }                 ← 默认。先统计不发分，查看影响面
//   { "activityId": "abc123" }        ← 只补发指定活动（其余忽略）
//   { "since": "2026-08-01" }         ← 只补发 finish 时间晚于该值的活动（活动有 _finishTime 时生效；否则按 timeEnd 兜底）
//   { "force": true }                 ← 强制补发（无视 rewarded 标记）。谨慎，会重复发分
//   { "limit": 10 }                   ← 最多处理 N 个活动（避免超时；分批跑：每批后 nextActivityIndex 续跑）
//
// 返回值形如：
//   {
//     ok: true,
//     dryRun: true/false,
//     pointsPerUser: 3,
//     activities: [
//       { id, name, finishTime, totalRegs, needAward, awarded, failed, skipped }
//     ],
//     totals: { activities: N, totalRegs, needAward, awarded, failed },
//     errors: [ { activityId, regId, userId, msg } ],
//     nextActivityIndex: 0,           ← 分批跑：把此值再传 event.activityIndex
//     done: true/false
//   }
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

/** 读取"集体活动"积分规则积分值（与 getActivities 内 getCollectivePoints 同款） */
async function getCollectivePoints() {
  try {
    const res = await db.collection('points_rules')
      .where({ name: '集体活动', status: 'active' })
      .limit(1)
      .get();
    if (res.data && res.data.length > 0 && res.data[0].points != null) {
      return parseInt(res.data[0].points, 10) || 0;
    }
  } catch (e) { console.warn('getCollectivePoints error', e); }
  return 0;
}

/** 取一个活动，分页循环拿全所有报名 */
async function getAllRegistrations(activityId) {
  const PAGE = 100;
  const regs = [];
  let skip = 0;
  while (true) {
    const res = await db.collection('activity_registrations')
      .where({ activityId }).skip(skip).limit(PAGE).get();
    regs.push(...(res.data || []));
    if ((res.data || []).length < PAGE) break;
    skip += PAGE;
  }
  return regs;
}

/** 取已 finish 的活动列表（按 createTime 升序，分页）
 * 支持 statusList 自定义：默认 ['finished']，可改 ['active','completed','ended'] 等任意字符串
 * 仅 statusList 决定 status 字段过滤，不影响其它内部判定
 */
async function listFinishedActivities(skip, limit, statusList) {
  const statuses = Array.isArray(statusList) && statusList.length ? statusList : ['finished'];
  const res = await db.collection('activities')
    .where({ status: _.in(statuses) })
    .orderBy('createTime', 'asc')
    .skip(skip).limit(limit)
    .get();
  return res.data || [];
}

/** 单个活动单条报名补发积分（独立 try/catch，不会让其他用户受影响） */
async function awardOne(reg, act, points, dryRun) {
  const r = {
    activityId: act._id,
    regId: reg._id,
    userId: reg.userId,
  };
  try {
    // 用户存在性校验（userId 必须是 users._id）
    const u = await db.collection('users').doc(reg.userId).get();
    if (!u.data) {
      r.msg = 'users 集合无此 userId';
      r.failed = true;
      return r;
    }
    // dryRun 不实际写入
    if (dryRun) {
      r.dryRun = true;
      r.wouldAward = points;
      return r;
    }
    // 写流水
    await db.collection('points_records').add({
      data: {
        userId: reg.userId,
        type: 'earn',
        category: '集体活动',
        points,
        description: `补发-参加活动：${act.name}`,
        status: 'approved',
        source: 'fixActivityPoints',  // 跟正常发分区分开，便于复盘
        createTime: new Date(),
        earnDate: new Date(),
        expireDate: new Date(Date.now() + 365 * 86400000),
      },
    });
    // 原子自增用户余额
    await db.collection('users').doc(reg.userId).update({ data: { points: _.inc(points) } });
    // 打标记，避免重复发分
    await db.collection('activity_registrations').doc(reg._id).update({
      data: { rewarded: true, rewardedAt: new Date(), rewardedFrom: 'fixActivityPoints' },
    });
    r.awarded = points;
    return r;
  } catch (e) {
    r.msg = (e && e.message) || String(e);
    r.failed = true;
    return r;
  }
}

exports.main = async (event = {}) => {
  const dryRun = event.dryRun !== false;  // 默认 true，更安全
  const activityId = event.activityId || '';
  const since = event.since ? new Date(event.since) : null;
  const force = !!event.force;
  const limit = Math.min(parseInt(event.limit, 10) || 50, 200);
  const startIndex = Math.max(parseInt(event.activityIndex, 10) || 0, 0);
  const statusList = Array.isArray(event.statusList) && event.statusList.length
    ? event.statusList
    : ['finished'];
  const queryAll = event.queryAll === true;   // 调试模式：忽略状态过滤，把所有活动按"时间已过"判定
  const cleanupStale = event.cleanupStale === true; // 把 status='active' 但 timeEnd 已过的活动一次性改为 'finished'
  const pointsPerUser = await getCollectivePoints();

  // 0 分时不报错的特殊处理（避免静默）
  const result = {
    ok: true,
    dryRun,
    force,
    statusList,
    queryAll,
    pointsPerUser,
    activities: [],
    totals: { activities: 0, totalRegs: 0, needAward: 0, awarded: 0, failed: 0 },
    errors: [],
    nextActivityIndex: startIndex,
    done: true,
  };
  if (pointsPerUser <= 0) {
    result.ok = false;
    result.error = '积分规则"集体活动"未启用或 points=0，请先在积分管理启用规则';
    return result;
  }

  // 取指定活动 OR 列表分页
  let activities = [];
  if (activityId) {
    const r = await db.collection('activities').doc(activityId).get();
    if (r && r.data) activities = [r.data];
    else { result.ok = false; result.error = '未找到 activityId=' + activityId; return result; }
  } else if (queryAll) {
    // 调试模式：忽略 status 字段，全部活动按 timeEnd 判定
    const res = await db.collection('activities')
      .orderBy('createTime', 'asc').skip(startIndex).limit(limit).get();
    activities = res.data || [];
  } else {
    activities = await listFinishedActivities(0, startIndex + limit, statusList);
    activities = activities.slice(startIndex, startIndex + limit);
  }

  for (let i = 0; i < activities.length; i++) {
    const act = activities[i];
    const item = {
      id: act._id,
      name: act.name,
      status: act.status,
      finishTime: act._finishTime || act.timeEnd || null,
      totalRegs: 0,
      needAward: 0,
      awarded: 0,
      failed: 0,
      skipped: 0,
      skipReason: '',
    };
    try {
      const regs = await getAllRegistrations(act._id);
      item.totalRegs = regs.length;
      // 时间窗口过滤（since 只看一个时间点之后 finish 的活动）
      if (since && item.finishTime && new Date(item.finishTime) < since) {
        item.skipped = regs.length;
        item.skipReason = 'before since';
        result.activities.push(item);
        continue;
      }
      // queryAll 模式下，仅 timeEnd 已过才视为该补发
      if (queryAll && statusList.indexOf(act.status) === -1) {
        if (!act.timeEnd || new Date(act.timeEnd) >= new Date()) {
          item.skipped = regs.length;
          item.skipReason = 'not yet ended';
          result.activities.push(item);
          continue;
        }
      }
      for (const reg of regs) {
        if (reg.status !== 'active') continue;          // 已取消报名不补发
        if (!force && reg.rewarded === true) continue;  // 已发过不补发
        item.needAward++;
        const r = await awardOne(reg, act, pointsPerUser, dryRun);
        if (r.failed) { item.failed++; result.errors.push({ activityId: act._id, regId: reg._id, userId: reg.userId, msg: r.msg }); }
        else if (r.awarded) item.awarded++;
      }
    } catch (e) {
      item.failed++;
      result.errors.push({ activityId: act._id, regId: null, userId: null, msg: '活动处理失败: ' + ((e && e.message) || String(e)) });
    }
    result.activities.push(item);
    result.totals.totalRegs += item.totalRegs;
    result.totals.needAward += item.needAward;
    result.totals.awarded += item.awarded;
    result.totals.failed += item.failed;
  }

  if (!activityId) {
    result.nextActivityIndex = startIndex + activities.length;
    result.done = activities.length < limit;
  }
  result.totals.activities = result.activities.length;

  // 清理过期未结束的 status='active' 活动：一次性改成 'finished'（仅在 queryAll + cleanupStale 时执行）
  if (cleanupStale && queryAll) {
    try {
      const stale = await db.collection('activities')
        .where({ status: 'active', timeEnd: _.lt(new Date().toISOString()) })
        .limit(200)
        .get();
      let updated = 0;
      for (const a of stale.data || []) {
        await db.collection('activities').doc(a._id).update({ data: { status: 'finished', _finishTime: new Date() } });
        updated++;
      }
      result.cleanupStale = { updated, scanned: (stale.data || []).length };
    } catch (e) {
      result.cleanupStale = { error: (e && e.message) || String(e) };
    }
  }

  return result;
};
