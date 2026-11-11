// cloudfunctions/getActivities - 活动CRUD
const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { action, id, data, userId, skip, limit } = event || {};

  // 定时触发器入口（每天 03:00 自动跑 autoFinish，不依赖用户访问），也可手动传 { autoFinishSweep: true }
  if (event && (event.TriggerName === 'autoFinishActivitySweep' || event.autoFinishSweep === true)) {
    const r = await autoFinish();
    return { ok: true, source: 'trigger', time: new Date().toISOString(), ...r };
  }

  // ===== 成员门禁 =====
  // 活动内容（列表/详情/报名/我的）仅对已注册的团内成员开放。
  // 通过分享卡片打开的陌生人也会走到这里，一律返回 needRegister，由前端引导去注册加入。
  // 管理端 action（all/create/update/...）不在此列，避免影响后台。
  const MEMBER_ACTIONS = ['detail', 'list', 'my', 'register', 'unregister'];
  if (MEMBER_ACTIONS.indexOf(action) >= 0) {
    const uid = userId || (event.userInfo && event.userInfo._id) || '';
    if (!(await isMember(uid))) return NEED_REGISTER;
  }

  if (action === 'create') {
    return await db.collection('activities').add({ data: { ...data, status: 'active', createTime: new Date() } });
  }
  if (action === 'update') {
    return await db.collection('activities').doc(id).update({ data });
  }
  if (action === 'cancel') {
    await db.collection('activities').doc(id).update({ data: { status: 'cancelled' } });
    await db.collection('activity_registrations').where({ activityId: id }).update({ data: { status: 'cancelled' } });
    return { ok: true };
  }
  if (action === 'finish') {
    const result = await finishActivity(id);
    return { ok: true, awarded: result.awarded || 0, failed: result.failed || 0, total: result.total || 0 };
  }
  if (action === 'delete') {
    await db.collection('activities').doc(id).remove();
    await db.collection('activity_registrations').where({ activityId: id }).remove();
    return { ok: true };
  }
  if (action === 'detail') {
    const act = await db.collection('activities').doc(id).get();
    // 报名人数由服务端算：客户端不再拉报名名单（名单含手机号，仅管理员可见）
    const cnt = await db.collection('activity_registrations')
      .where({ activityId: id, status: 'active' }).count().catch(() => ({ total: 0 }));
    return { ...act.data, regCount: (cnt && cnt.total) || 0 };
  }

  // 共用：自动完成已结束的活动
  // 触发：① 定时器（每天 03:00，不依赖用户访问）；② 用户进入活动列表（list/all/my 三个 action 内调用）
  async function autoFinish() {
    const now = new Date();
    const expired = await db.collection('activities')
      .where({ status: 'active', timeEnd: _.lt(new Date().toISOString()) }).get();
    const list = expired.data || [];
    let swept = 0;
    let failed = 0;
    const details = [];
    for (const a of list) {
      try {
        const r = await finishActivity(a._id);
        swept++;
        if (r && r.failed > 0) {
          failed++;
          details.push({ activityId: a._id, name: a.name, failed: r.failed, awarded: r.awarded, total: r.total });
        } else if (r && r.awarded > 0) {
          details.push({ activityId: a._id, name: a.name, awarded: r.awarded, total: r.total });
        }
      } catch (e) {
        failed++;
        console.error('[autoFinish] finish failed for', a._id, e);
        details.push({ activityId: a._id, name: a.name, error: (e && e.message) || String(e) });
      }
    }
    return { swept, failed, total: list.length, details };
  }

  // 列表：返回全部状态活动（含已结束/已取消），由前端按 stateTag + filterIdx 筛选
  if (action === 'list') {
    await autoFinish();
    const now = new Date();
    const query = db.collection('activities').orderBy('timeStart', 'asc');
    const totalRes = await query.count();
    const res = await query.skip(skip || 0).limit(limit || 20).get();
    const ids = res.data.map(a => a._id);
    const countMap = {};
    if (ids.length) {
      const regs = await db.collection('activity_registrations')
        .where({ activityId: _.in(ids), status: 'active' }).get();
      regs.data.forEach(r => { countMap[r.activityId] = (countMap[r.activityId] || 0) + 1; });
    }
    return {
      list: res.data.map(a => ({
        ...a, regCount: countMap[a._id] || 0,
        stateTag: computeState(a, countMap[a._id] || 0, now),
      })),
      total: totalRes.total,
      hasMore: (skip || 0) + (limit || 20) < totalRes.total,
    };
  }

  // 所有活动（管理端）
  if (action === 'all') {
    await autoFinish();
    const now = new Date();
    const query = db.collection('activities').orderBy('timeStart', 'asc');
    const totalRes = await query.count();
    const res = await query.skip(skip || 0).limit(limit || 20).get();
    const ids = res.data.map(a => a._id);
    const countMap = {};
    if (ids.length) {
      const regs = await db.collection('activity_registrations')
        .where({ activityId: _.in(ids), status: 'active' }).get();
      regs.data.forEach(r => { countMap[r.activityId] = (countMap[r.activityId] || 0) + 1; });
    }
    return {
      list: res.data.map(a => ({
        ...a, regCount: countMap[a._id] || 0,
        stateTag: computeState(a, countMap[a._id] || 0, now),
      })),
      total: totalRes.total,
      hasMore: (skip || 0) + (limit || 20) < totalRes.total,
    };
  }

  // 我的活动（用户报名过的）
  if (action === 'my') {
    const regs = await db.collection('activity_registrations')
      .where({ userId, status: 'active' })
      .orderBy('createTime', 'desc')
      .get();
    if (!regs.data.length) return { list: [] };
    const actIds = [...new Set(regs.data.map(r => r.activityId))];
    const acts = await db.collection('activities')
      .where({ _id: _.in(actIds), status: _.neq('cancelled') })
      .orderBy('timeStart', 'asc')
      .get();
    // 报名人数
    const countMap = {};
    const allRegs = await db.collection('activity_registrations')
      .where({ activityId: _.in(actIds), status: 'active' }).get();
    allRegs.data.forEach(r => { countMap[r.activityId] = (countMap[r.activityId] || 0) + 1; });
    return {
      list: acts.data.map(a => ({
        ...a, regCount: countMap[a._id] || 0,
        stateTag: computeState(a, countMap[a._id] || 0, new Date()),
      })),
    };
  }

  // 报名
  if (action === 'register') {
    const { activityId, userInfo, customValues } = event;
    const uid = (userInfo && userInfo._id) || userId;
    if (!uid) return { error: '未登录' };
    // 检查是否已报名
    const exist = await db.collection('activity_registrations')
      .where({ activityId, userId: uid, status: 'active' }).get();
    if (exist.data.length) return { error: '已报名' };
    // 检查活动详情（截止时间 + 人数上限）
    const act = await db.collection('activities').doc(activityId).get();
    if (act.data.deadline && new Date(act.data.deadline) < new Date()) {
      return { error: '报名已截止' };
    }
    if (act.data.maxPeople) {
      const cnt = await db.collection('activity_registrations')
        .where({ activityId, status: 'active' }).count();
      if (cnt.total >= act.data.maxPeople) return { error: '已满员' };
    }
    return await db.collection('activity_registrations').add({
      data: {
        activityId, userId: uid,
        userName: (userInfo && userInfo.nickName) || '',
        userPhone: (userInfo && userInfo.phone) || '',
        customValues: customValues || {},
        status: 'active',
        createTime: new Date(),
      },
    });
  }

  // 取消报名
  if (action === 'unregister') {
    await db.collection('activity_registrations')
      .where({ activityId: event.activityId, userId })
      .update({ data: { status: 'cancelled' } });
    return { ok: true };
  }

  // 报名列表（管理端）：名单含手机号，服务端校验管理员身份，不能只靠前端隐藏
  if (action === 'registrations') {
    if (!(await isAdminCaller())) return { error: '无权限' };
    const res = await db.collection('activity_registrations')
      .where({ activityId: id, status: 'active' })
      .orderBy('createTime', 'asc')
      .get();
    return { list: res.data };
  }

  return { error: 'unknown action' };
};

// 是否已注册成员：users 表里存在记录（_id 或 openid 命中）且审核通过。
// status: pending（注册未选群待审核）/ rejected（已驳回）不能使用；老用户无 status 视为已通过。
async function isMember(uid) {
  if (!uid) return false;
  let u = null;
  const r = await db.collection('users').doc(uid).get().catch(() => null);
  if (r && r.data) u = r.data;
  else {
    const q = await db.collection('users').where({ _openid: uid }).limit(1).get().catch(() => null);
    if (q && q.data && q.data.length) u = q.data[0];
  }
  if (!u) return false;
  return u.status !== 'pending' && u.status !== 'rejected';
}

// 是否管理员：按调用者 openid 查 users.role
async function isAdminCaller() {
  try {
    const { OPENID } = cloud.getWXContext();
    if (!OPENID) return false;
    const q = await db.collection('users').where({ _openid: OPENID }).limit(1).get();
    const u = q.data && q.data[0];
    return !!(u && (u.role === 'admin' || u.role === 'super_admin'));
  } catch (e) {
    console.warn('isAdminCaller error', e);
    return false;
  }
}
const NEED_REGISTER = { ok: false, needRegister: true, error: '请先注册加入跑团' };

// 计算展示状态
function computeState(a, regCount, now) {
  if (a.status === 'cancelled') return { cls: 'state-s7', text: '已取消' };
  if (a.status === 'finished' || (a.timeEnd && new Date(a.timeEnd) < now)) return { cls: 'state-s6', text: '已完成' };
  if (a.maxPeople && regCount >= a.maxPeople) return { cls: 'state-s5', text: '已满员' };
  if (a.deadline && new Date(a.deadline) < now) return { cls: 'state-s4', text: '已截止' };
  if (a.timeStart && new Date(a.timeStart) < now) return { cls: 'state-s2', text: '进行中' };
  return { cls: 'state-s1', text: '报名中' };
}

// 完成活动并发放积分：仅「集体活动」规则启用时发分，禁用/删除/未配置返回 0 不发分
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

async function finishActivity(activityId) {
  await db.collection('activities').doc(activityId).update({ data: { status: 'finished' } });
  const act = await db.collection('activities').doc(activityId).get();
  // 幂等：只发从未发过分的人（rewarded!=true）。重复 finish / autoFinish 不会重发
  const regs = await db.collection('activity_registrations')
    .where({ activityId, status: 'active', rewarded: _.neq(true) }).get();
  const points = await getCollectivePoints();
  // 规则未启用（禁用/删除/未配置）时不发积分
  if (points <= 0) return 0;
  let awarded = 0;
  let failed = 0;
  for (const r of regs.data) {
    try {
      await db.collection('points_records').add({
        data: {
          userId: r.userId, type: 'earn', category: '集体活动', points,
          description: `参加活动：${act.data.name}`, status: 'approved',
          createTime: new Date(), earnDate: new Date(),
          expireDate: new Date(Date.now() + 365 * 86400000),
        },
      });
      // 原子自增，避免并发 finish 时覆盖丢失
      await db.collection('users').doc(r.userId).update({ data: { points: _.inc(points) } });
      // 标记已发放，下次重复触发不再处理
      await db.collection('activity_registrations').doc(r._id).update({ data: { rewarded: true, rewardedAt: new Date() } });
      awarded++;
    } catch (e) {
      failed++;
      // 单条失败不影响其他用户（修复原 bug：循环里没有 try/catch，首个错误会导致全员不发）
      console.error('[finishActivity] skip reg', r._id, r.userId, e);
    }
  }
  return { awarded, failed, total: regs.data.length };
}
