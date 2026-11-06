// cloudfunctions/raceEvent - 自办赛事（线下 / 线上）
//
// 与现有赛事体系的边界（docs/自办赛事-设计.md）：
// - 自办赛就是 race_events 里的一条（source='self'），共用日历 / 详情 / 评价 / 互助
// - 报名写在现成的 race_markers（status='registered'，退赛 status='quit'）
// - 线上成绩先进 race_result_submits，审核通过才写 race_records（不污染跑马记录）
// - 新建 / 编辑 / 删除 / 报名 / 提交 / 审核全部走本函数，服务端校验管理员身份
//   （现有赛事管理是客户端直写，自办赛不再沿用这个信任模型）
//
// 注意：race_markers.userId 存的是 users._id 不是 openid（历史坑，已踩两次），
//       本函数入参 userId 统一走 resolveUser 兼容两种。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const MARKERS = 'race_markers';
const SUBMITS = 'race_result_submits';
const RECORDS = 'race_records';
const EVENTS = 'race_events';

// 预设距离档（自定义档由管理员填公里数）
const GROUP_PRESETS = {
  '5km': 5,
  '10km': 10,
  '半马': 21.0975,
  '全马': 42.195,
};
// 机械校验：成绩下限（秒），低于即异常（设计文档 10.1）
const MIN_RESULT_SEC = { '10km': 22 * 60, '半马': 55 * 60, '全马': 115 * 60 };
const PACE_LIMIT = 150; // 秒/公里，> 2:30/km 直接拒

const ok = (data = {}) => Object.assign({ ok: true }, data);
const fail = (error) => ({ ok: false, error });

// 云函数跑 UTC，日期口径统一 +8 小时（设计文档 12.3）
function todayStr() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

async function resolveUser(rawId) {
  if (!rawId) return null;
  // 先当 users._id 查
  let r = await db.collection('users').doc(rawId).get().catch(() => null);
  if (r && r.data) return r.data;
  // 再当 openid 查（兼容前端直接传 openid 的调用方）
  r = await db.collection('users').where({ _openid: rawId }).limit(1).get().catch(() => null);
  if (r && r.data && r.data.length) return r.data[0];
  r = await db.collection('users').where({ openid: rawId }).limit(1).get().catch(() => null);
  if (r && r.data && r.data.length) return r.data[0];
  return null;
}

// 管理员口径与前端一致：超管（users.role）或 admins 表在有效期的成员
async function isAdminUser(userId) {
  const u = await db.collection('users').doc(userId).get().catch(() => null);
  if (u && u.data && u.data.role === 'super_admin') return true;
  const now = new Date();
  const a = await db.collection('admins').where({
    userId, status: 'active', validFrom: _.lte(now), validTo: _.gte(now),
  }).limit(1).get().catch(() => null);
  return !!(a && a.data && a.data.length);
}

async function getEvent(eventId) {
  const r = await db.collection(EVENTS).doc(eventId).get().catch(() => null);
  return r && r.data ? r.data : null;
}

// 某赛事当前占名额的报名数（registered + finished；quit / dns 释放名额）
async function countActiveSignups(eventId) {
  const c = await db.collection(MARKERS)
    .where({ eventId, status: _.in(['registered', 'finished']) })
    .count().catch(() => ({ total: 0 }));
  return c.total || 0;
}

// 老数据没有 source 字段 → official
function eventMode(ev) {
  return { source: ev.source || 'official', mode: ev.mode || 'offline' };
}

// 'H:MM:SS' / 'MM:SS' → 秒；非法返回 -1
function parseResult(text) {
  const m = String(text || '').trim().match(/^(\d{1,2}):([0-5]?\d):([0-5]?\d)$/) ||
    String(text || '').trim().match(/^([0-5]?\d):([0-5]?\d)$/);
  if (!m) return -1;
  const parts = m.slice(1).map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return parts[0] * 60 + parts[1];
}

function secToText(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

// 组别名 → raceType（race_records 既有口径：full/half/10k/custom）
function groupToRaceType(groupName, km) {
  if (/全马|full/i.test(groupName)) return 'full';
  if (/半马|half/i.test(groupName)) return 'half';
  if (/^10/i.test(groupName)) return '10k';
  return 'custom';
}

// callFunction 不传 Date（会被序列化成 ISO 字符串），日期统一在服务端转回 Date。
// 日历查询（getRaceEvents）用 Date 类型比较 date 字段，自办赛存字符串会导致
// 类型不匹配、赛事在日历里永远查不到（10k邀请赛 搜不到就是这个原因）。
// date-only 串按北京时间当天 0 点入库（UTC 前一天 16 点），与客户端 new Date('YYYY-MM-DD') 语义一致。
function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  const m = String(v).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) - 8 * 3600 * 1000);
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}

// 首次写入前集合可能不存在（-502005）：自动建表后重试一次
async function ensureAdd(coll, data) {
  try {
    return await db.collection(coll).add({ data });
  } catch (e) {
    const code = String((e && e.errCode) || '');
    const msg = String((e && (e.errMsg || e.message)) || '');
    if (code === '-502005' || /not exist/i.test(msg)) {
      try { await db.createCollection(coll); } catch (_) { /* 已存在 */ }
      return await db.collection(coll).add({ data });
    }
    throw e;
  }
}

// ==================== 赛事管理 ====================

// 自办赛字段规范化：只认白名单，客户端多传的不收
function normalizeSelfFields(d, isCreate) {
  const out = {};
  const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n == null ? 500 : n);
  const dateStr = String(d.date || '').slice(0, 10); // 比赛日期（日历展示 / 倒计时用）
  out.mode = d.mode === 'online' ? 'online' : 'offline';
  out.capacity = Math.max(0, Math.min(10000, Number(d.capacity) || 0));
  out.signupDeadline = str(d.signupDeadline, 10);   // 'YYYY-MM-DD'，空 = 不限
  out.feeNote = str(d.feeNote, 200);
  out.healthNotice = str(d.healthNotice, 2000);
  // 距离档：数组存组名，groupKm 存公里数（预设档自动带，自定义档管理员可填）
  const groups = Array.isArray(d.groups) ? d.groups
    .map(g => String(g || '').trim().slice(0, 20)).filter(Boolean).slice(0, 10) : [];
  if (!groups.length && isCreate) return { error: '请至少设置一个距离档' };
  const groupKm = {};
  const srcKm = d.groupKm || {};
  groups.forEach(g => {
    const km = Number(srcKm[g] != null ? srcKm[g] : GROUP_PRESETS[g]);
    if (km > 0 && km <= 300) groupKm[g] = km;
  });
  out.groups = groups;
  out.groupKm = groupKm;
  if (out.mode === 'offline') {
    out.meetInfo = str(d.meetInfo, 500);          // 线下：集合时间地点
    out.location = str(d.location, 200);          // 线下：地点
    out.runWindow = null;
    out.resultDeadline = '';
    out.proofRequired = false;
    if (out.signupDeadline && dateStr && out.signupDeadline > dateStr) {
      return { error: '报名截止不能晚于比赛日期' };
    }
  } else {
    // 线上：无地点，必须有跑步窗口与成绩截止
    const ws = str(d.runWindow && d.runWindow.start, 10);
    const we = str(d.runWindow && d.runWindow.end, 10);
    if (!ws || !we) return { error: '线上赛必须设置跑步窗口' };
    if (ws > we) return { error: '跑步窗口开始不能晚于结束' };
    // 比赛日期驱动日历倒计时与排序，必须落在跑步窗口内，否则日历显示的「X天后」和实际窗口对不上
    if (dateStr) {
      if (dateStr < ws || dateStr > we) return { error: '比赛日期需落在跑步窗口内（建议填窗口第一天）' };
    }
    out.location = '';
    out.meetInfo = '';
    out.runWindow = { start: ws, end: we };
    out.resultDeadline = str(d.resultDeadline, 10);
    if (!out.resultDeadline) return { error: '线上赛必须设置成绩提交截止' };
    if (out.resultDeadline < we) return { error: '成绩提交截止不能早于跑步窗口结束' };
    out.proofRequired = d.proofRequired !== false;
  }
  out.rankEnabled = out.mode === 'online' ? d.rankEnabled !== false : !!d.rankEnabled;
  return { fields: out };
}

async function actionCreateEvent(userId, data) {
  const ev = data && data.event;
  if (!ev || !String(ev.name || '').trim()) return fail('缺少赛事名称');
  const norm = normalizeSelfFields(ev, true);
  if (norm.error) return fail(norm.error);
  const doc = Object.assign({}, ev, norm.fields, {
    source: 'self',
    date: toDate(ev.date),   // 统一转 Date，否则日历按 Date 比较会漏掉
    publishStatus: ev.publishStatus === 'draft' ? 'draft' : 'published',
    markerCount: 0,
    createTime: new Date(),
    updateTime: new Date(),
  });
  delete doc._id;
  const r = await ensureAdd(EVENTS, doc);
  return ok({ eventId: r._id });
}

async function actionUpdateEvent(userId, data) {
  const eventId = String(data.eventId || '');
  const ev = data.event;
  if (!eventId || !ev) return fail('缺少赛事或内容');
  const old = await getEvent(eventId);
  if (!old) return fail('赛事不存在');
  if (eventMode(old).source !== 'self') return fail('官方赛事请在赛事管理里编辑');
  const norm = normalizeSelfFields(Object.assign({}, old, ev), false);
  if (norm.error) return fail(norm.error);
  const patch = Object.assign({}, ev, norm.fields, { updateTime: new Date() });
  if (ev.date != null) patch.date = toDate(ev.date);
  delete patch._id;
  await db.collection(EVENTS).doc(eventId).update({ data: patch }).catch(e => { throw e; });
  return ok({ eventId });
}

// 删除级联（顺序：敏感数据先清；race_records 绝对不删）
async function actionDeleteEvent(userId, data) {
  const eventId = String(data.eventId || '');
  const ev = await getEvent(eventId);
  if (!ev) return fail('赛事不存在');
  if (eventMode(ev).source !== 'self') return fail('官方赛事不能在这里删除');
  const cnt = await countActiveSignups(eventId);
  // 有报名时前端已二次确认；这里再带一次统计进日志
  const del = async (coll, where) => {
    const r = await db.collection(coll).where(where).limit(500).get().catch(() => null);
    for (const d of ((r && r.data) || [])) {
      await db.collection(coll).doc(d._id).remove().catch(() => {});
    }
    return (r && r.data ? r.data.length : 0);
  };
  const removed = {};
  removed.helps = await del('race_helps', { eventId });
  removed.helpApplies = await del('race_help_applies', { eventId });
  removed.reviews = await del('race_reviews', { eventId });
  removed.submits = await del(SUBMITS, { eventId });
  removed.markers = await del(MARKERS, { eventId });
  await db.collection(EVENTS).doc(eventId).remove().catch(() => {});
  return ok({ removed, finishedKept: true, activeSignups: cnt });
}

// ==================== 报名 ====================

async function actionSignup(userId, data) {
  const eventId = String(data.eventId || '');
  const ev = await getEvent(eventId);
  if (!ev) return fail('赛事不存在');
  if (eventMode(ev).source !== 'self') return fail('该赛事不支持在线报名');
  const me = await resolveUser(userId);
  if (!me) return fail('仅限本团注册成员报名');
  let myId = me._id;
  // 代报名：报名截止后管理员补录（设计文档决策 13）
  if (data.byAdmin === true) {
    if (!(await isAdminUser(me._id))) return fail('仅管理员可代报名');
    const target = await resolveUser(String(data.targetUserId || ''));
    if (!target) return fail('未找到该成员');
    myId = target._id;
  }

  const today = todayStr();
  if (ev.signupDeadline && today > ev.signupDeadline) return fail('报名已截止');
  if (ev.status === 'cancelled') return fail('赛事已取消');
  const evDate = String(ev.date || '').slice(0, 10);
  if (evDate && today > evDate) return fail('赛事已结束');

  const group = String(data.group || '').trim().slice(0, 20);
  const groups = ev.groups || [];
  if (groups.length && !groups.includes(group)) return fail('请选择距离档');
  const emergencyContact = String(data.emergencyContact || '').trim().slice(0, 100);
  if (data.noticeAgreed !== true) return fail('请阅读并勾选免责声明');

  // 满员读时判定，不落库状态（设计文档 12.4）
  const capacity = Number(ev.capacity) || 0;
  if (capacity > 0) {
    const cnt = await countActiveSignups(eventId);
    if (cnt >= capacity) return fail('报名已满');
  }

  const exist = await db.collection(MARKERS).where({ userId: myId, eventId }).limit(1).get().catch(() => null);
  const m = exist && exist.data && exist.data[0];
  if (m && ['registered', 'finished'].includes(m.status)) return fail('你已报名过这场赛事');

  const payload = {
    userId: myId,
    eventId,
    status: 'registered',
    group,
    emergencyContact,
    noticeAgreed: true,
    paid: false, paidAt: null, paidNote: '',
    insuredStatus: ev.insuranceMode === 'none' ? 'none' : 'pending',
    quitAt: null,
    raceType: ev.raceType || '',
    updateTime: new Date(),
  };
  if (m) {
    // 之前只是关注（planned）或退过赛（quit）：升级成报名，沿用 notifyEnabled
    await db.collection(MARKERS).doc(m._id).update({
      data: Object.assign(payload, { regTime: m.regTime || new Date() }),
    });
    return ok({ markerId: m._id, reRegistered: true });
  }
  payload.notifyEnabled = data.notifyEnabled === true;
  payload.createTime = new Date();
  payload.regTime = new Date();
  const r = await ensureAdd(MARKERS, payload);
  await db.collection(EVENTS).doc(eventId).update({
    data: { markerCount: _.inc(1) },
  }).catch(() => {});
  return ok({ markerId: r._id });
}

async function actionQuit(userId, data) {
  const eventId = String(data.eventId || '');
  const ev = await getEvent(eventId);
  if (!ev) return fail('赛事不存在');
  const me = await resolveUser(userId);
  if (!me) return fail('请先登录');
  const isAdminOp = data.byAdmin === true && await isAdminUser(me._id);
  const q = isAdminOp ? { userId: String(data.targetUserId || ''), eventId }
    : { userId: me._id, eventId };
  const r = await db.collection(MARKERS).where(q).limit(1).get().catch(() => null);
  const m = r && r.data && r.data[0];
  if (!m) return fail('没有找到报名记录');
  if (!['registered', 'finished'].includes(m.status)) return fail('当前状态无法退赛');
  await db.collection(MARKERS).doc(m._id).update({
    data: { status: 'quit', quitAt: new Date(), updateTime: new Date() },
  });
  await db.collection(EVENTS).doc(eventId).update({
    data: { markerCount: _.inc(-1) },
  }).catch(() => {});
  return ok({ quit: true });
}

async function actionListSignups(userId, data) {
  const me = await resolveUser(userId);
  if (!me || !(await isAdminUser(me._id))) return fail('仅管理员可查看报名名单');
  const eventId = String(data.eventId || '');
  const ev = await getEvent(eventId);
  if (!ev) return fail('赛事不存在');
  const r = await db.collection(MARKERS).where({ eventId })
    .orderBy('regTime', 'asc').limit(500).get().catch(() => null);
  const rows = (r && r.data) || [];
  // 昵称头像一次性查齐
  const ids = [...new Set(rows.map(x => x.userId).filter(Boolean))];
  const uMap = {};
  for (const id of ids) {
    const u = await db.collection('users').doc(id).get().catch(() => null);
    if (u && u.data) uMap[id] = u.data;
  }
  const list = rows.map(x => ({
    _id: x._id, userId: x.userId,
    nickName: (uMap[x.userId] && (uMap[x.userId].nickName || uMap[x.userId].nickname)) || '未知',
    avatarUrl: (uMap[x.userId] && uMap[x.userId].avatarUrl) || '',
    status: x.status, group: x.group || '', emergencyContact: x.emergencyContact || '',
    paid: !!x.paid, paidAt: x.paidAt || null,
    insuredStatus: x.insuredStatus || 'none',
    recordId: x.recordId || '',
    regTime: x.regTime || x.createTime || null,
    quitAt: x.quitAt || null,
  }));
  const active = list.filter(x => ['registered', 'finished'].includes(x.status)).length;
  return ok({ list, active, capacity: Number(ev.capacity) || 0, event: { name: ev.name, mode: ev.mode || 'offline' } });
}

async function actionMarkPaid(userId, data) {
  const me = await resolveUser(userId);
  if (!me || !(await isAdminUser(me._id))) return fail('仅管理员可标记收款');
  const markerId = String(data.markerId || '');
  const paid = data.paid !== false;
  const r = await db.collection(MARKERS).doc(markerId).get().catch(() => null);
  if (!r || !r.data) return fail('报名记录不存在');
  await db.collection(MARKERS).doc(markerId).update({
    data: { paid, paidAt: paid ? new Date() : null, updateTime: new Date() },
  });
  return ok({ paid });
}

// ==================== 线上成绩 ====================

async function actionSubmitResult(userId, data) {
  const eventId = String(data.eventId || '');
  const ev = await getEvent(eventId);
  if (!ev) return fail('赛事不存在');
  if (eventMode(ev).mode !== 'online') return fail('只有线上赛需要提交成绩');
  const me = await resolveUser(userId);
  if (!me) return fail('请先登录');
  const myId = me._id;

  // 必须已报名
  const mr = await db.collection(MARKERS).where({ userId: myId, eventId }).limit(1).get().catch(() => null);
  const marker = mr && mr.data && mr.data[0];
  if (!marker || !['registered', 'finished'].includes(marker.status)) return fail('请先报名再提交成绩');

  const today = todayStr();
  if (ev.resultDeadline && today > ev.resultDeadline) return fail('已过成绩提交截止时间');
  const runDate = String(data.runDate || '').slice(0, 10);
  const win = ev.runWindow || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(runDate)) return fail('请选择跑步日期');
  if (win.start && runDate < win.start) return fail('跑步日期早于开跑窗口');
  if (win.end && runDate > win.end) return fail('跑步日期晚于跑步窗口');

  const distanceKm = Number(data.distanceKm);
  if (!(distanceKm > 0) || distanceKm > 300) return fail('请填写有效距离');
  const resultSec = parseResult(data.result);
  if (resultSec <= 0) return fail('成绩格式应为 时:分:秒');
  const resultText = secToText(resultSec);

  // 机械校验（设计文档 10.1）
  const group = String(data.group || marker.group || '').slice(0, 20);
  const km = (ev.groupKm || {})[group] || GROUP_PRESETS[group] || 0;
  if (km > 0) {
    if (distanceKm < km * 0.95) return fail(`距离不足：${group} 需跑满 ${km} 公里`);
    if (distanceKm > km * 1.3) return fail('距离与所选档位不符，请核对');
  }
  const pace = resultSec / distanceKm;
  if (pace > PACE_LIMIT) return fail('配速异常（超过 2:30/km），请核对距离与成绩');
  const minSec = MIN_RESULT_SEC[group];
  if (minSec && resultSec < minSec) return fail('成绩异常：低于该距离的可信下限，请核对');
  const proofImages = Array.isArray(data.proofImages) ? data.proofImages.slice(0, 3) : [];
  if (ev.proofRequired !== false && proofImages.length === 0) return fail('请上传跑步截图');
  if (proofImages.length === 0 && !String(data.note || '').trim()) {
    return fail('无截图时请填写备注说明');
  }

  // 同赛事一人一条 approved；pending 覆盖；rejected 可改一次
  const mine = await db.collection(SUBMITS).where({ userId: myId, eventId }).limit(5).get().catch(() => null);
  const rows = (mine && mine.data) || [];
  if (rows.some(x => x.status === 'approved')) return fail('你的成绩已通过审核，无需重复提交');
  const pending = rows.find(x => x.status === 'pending');
  const rejected = rows.find(x => x.status === 'rejected');
  if (!pending && rejected && (rejected.retryCount || 0) >= 2) {
    return fail('成绩已被驳回两次，不能再提交，请联系管理员');
  }

  // 图片查重：同一 fileID 已在别的提交里出现 → 标记疑似复用，交人工判断（不自动拒）
  const others = await db.collection(SUBMITS).where({ eventId }).limit(200).get().catch(() => null);
  const used = new Set();
  for (const o of ((others && others.data) || [])) {
    if (o.userId === myId && o.status !== 'rejected') continue;
    (o.proofImages || []).forEach(f => used.add(f));
  }
  const flags = proofImages.some(f => used.has(f)) ? ['reuse'] : [];

  const doc = {
    eventId, userId: myId, openid: me.openid || me._openid || '',
    group, runDate, distanceKm,
    result: resultText, resultSec, paceText: `${Math.floor(pace / 60)}'${String(Math.round(pace % 60)).padStart(2, '0')}/km`,
    proofImages, note: String(data.note || '').trim().slice(0, 200),
    flags, status: 'pending',
    createTime: new Date(), updateTime: new Date(),
  };
  if (pending) {
    doc.retryCount = pending.retryCount || 0;
    await db.collection(SUBMITS).doc(pending._id).update({ data: doc });
    return ok({ submitId: pending._id, resubmitted: false, flags });
  }
  if (rejected) {
    doc.retryCount = (rejected.retryCount || 0) + 1;
    doc.lastRejectedNote = rejected.reviewNote || '';
    await db.collection(SUBMITS).doc(rejected._id).update({ data: doc });
    return ok({ submitId: rejected._id, resubmitted: true, flags });
  }
  const r = await ensureAdd(SUBMITS, doc);
  return ok({ submitId: r._id, flags });
}

async function actionReviewResult(userId, data) {
  const me = await resolveUser(userId);
  if (!me || !(await isAdminUser(me._id))) return fail('仅管理员可审核成绩');
  const submitId = String(data.submitId || '');
  const pass = data.pass === true;
  const note = String(data.note || '').trim().slice(0, 200);
  if (!pass && !note) return fail('驳回必须写明理由');
  const sr = await db.collection(SUBMITS).doc(submitId).get().catch(() => null);
  const sub = sr && sr.data;
  if (!sub) return fail('提交记录不存在');
  if (sub.status !== 'pending') return fail('该成绩已处理过');
  const ev = await getEvent(sub.eventId);
  if (!ev) return fail('赛事不存在');

  if (!pass) {
    await db.collection(SUBMITS).doc(submitId).update({
      data: {
        status: 'rejected', reviewerId: me._id, reviewNote: note,
        retryCount: (sub.retryCount || 0) + 1, reviewTime: new Date(), updateTime: new Date(),
      },
    });
    return ok({ status: 'rejected' });
  }

  // 通过：写 race_records（审核单号做防重幂等），回填 marker
  const dup = await db.collection(RECORDS).where({ submitId }).limit(1).count().catch(() => ({ total: 0 }));
  if (dup.total > 0) return fail('该成绩已写入记录，请勿重复审核');
  const record = {
    userId: sub.userId,
    raceType: groupToRaceType(sub.group, sub.distanceKm),
    status: 'finished',
    date: sub.runDate,
    city: ev.name,                    // 沿用现有约定：city 字段存赛事名（detail.js 查重依赖）
    result: sub.result,
    rank: 0,
    note: `[线上·${ev.name}]${sub.note ? ' ' + sub.note : ''}`,
    isPublic: true,
    images: sub.proofImages || [],
    certImages: [],
    distanceKm: sub.distanceKm,
    source: 'self',
    raceMode: 'online',
    eventId: sub.eventId,
    eventName: ev.name,
    submitId,
    createTime: new Date(),
  };
  await ensureAdd(RECORDS, record);
  await db.collection(SUBMITS).doc(submitId).update({
    data: {
      status: 'approved', reviewerId: me._id, reviewNote: note,
      reviewTime: new Date(), updateTime: new Date(),
    },
  });
  // marker → finished + recordId
  const mr = await db.collection(MARKERS).where({ userId: sub.userId, eventId: sub.eventId }).limit(1).get().catch(() => null);
  if (mr && mr.data && mr.data[0]) {
    const rec = await db.collection(RECORDS).where({ submitId }).limit(1).get().catch(() => null);
    await db.collection(MARKERS).doc(mr.data[0]._id).update({
      data: { status: 'finished', recordId: rec && rec.data && rec.data[0] ? rec.data[0]._id : '', updateTime: new Date() },
    }).catch(() => {});
  }
  return ok({ status: 'approved' });
}

async function actionPendingResults(userId, data) {
  const me = await resolveUser(userId);
  if (!me || !(await isAdminUser(me._id))) return fail('仅管理员可审核成绩');
  const eventId = String(data.eventId || '');
  const q = { status: 'pending' };
  if (eventId) q.eventId = eventId;
  const r = await db.collection(SUBMITS).where(q).orderBy('createTime', 'asc').limit(100).get().catch(() => null);
  const rows = (r && r.data) || [];
  // 赛事名与提交人一次性查齐
  const evIds = [...new Set(rows.map(x => x.eventId))];
  const evMap = {};
  for (const id of evIds) {
    const e = await getEvent(id).catch(() => null);
    if (e) evMap[id] = e.name;
  }
  const uMap = {};
  const uids = [...new Set(rows.map(x => x.userId))];
  for (const id of uids) {
    const u = await db.collection('users').doc(id).get().catch(() => null);
    if (u && u.data) uMap[id] = u.data;
  }
  const list = rows.map(x => ({
    _id: x._id, eventId: x.eventId, eventName: evMap[x.eventId] || '',
    nickName: (uMap[x.userId] && (uMap[x.userId].nickName || uMap[x.userId].nickname)) || '未知',
    group: x.group, runDate: x.runDate, distanceKm: x.distanceKm,
    result: x.result, paceText: x.paceText, proofImages: x.proofImages || [],
    note: x.note || '', flags: x.flags || [], retryCount: x.retryCount || 0,
    createTime: x.createTime,
  }));
  return ok({ list });
}

async function actionMyResults(userId, data) {
  const eventId = String(data.eventId || '');
  const me = await resolveUser(userId);
  if (!me) return fail('请先登录');
  const r = await db.collection(SUBMITS).where({ userId: me._id, eventId })
    .orderBy('createTime', 'desc').limit(5).get().catch(() => null);
  return ok({
    list: ((r && r.data) || []).map(x => ({
      _id: x._id, status: x.status, group: x.group, runDate: x.runDate,
      distanceKm: x.distanceKm, result: x.result, paceText: x.paceText,
      reviewNote: x.reviewNote || '', retryCount: x.retryCount || 0,
    })),
  });
}

async function actionOnlineRank(userId, data) {
  const eventId = String(data.eventId || '');
  const ev = await getEvent(eventId);
  if (!ev) return fail('赛事不存在');
  const r = await db.collection(SUBMITS).where({ eventId, status: 'approved' }).limit(500).get().catch(() => null);
  const rows = (r && r.data) || [];
  const uMap = {};
  for (const id of [...new Set(rows.map(x => x.userId))]) {
    const u = await db.collection('users').doc(id).get().catch(() => null);
    if (u && u.data) uMap[id] = u.data;
  }
  const all = rows.map(x => ({
    userId: x.userId,
    nickName: (uMap[x.userId] && (uMap[x.userId].nickName || uMap[x.userId].nickname)) || '跑友',
    avatarUrl: (uMap[x.userId] && uMap[x.userId].avatarUrl) || '',
    group: x.group || '未分组', runDate: x.runDate,
    distanceKm: x.distanceKm, result: x.result, resultSec: x.resultSec, paceText: x.paceText,
  }));
  all.sort((a, b) => a.group.localeCompare(b.group) || a.resultSec - b.resultSec);
  // 各组内名次
  const counters = {};
  all.forEach(x => {
    counters[x.group] = (counters[x.group] || 0) + 1;
    x.rank = counters[x.group];
  });
  return ok({
    groups: ev.groups || [], groupKm: ev.groupKm || {},
    list: all, total: all.length,
  });
}

// 详情页报名区聚合：我的报名 / 我的成绩提交 / 已通过人数
async function actionMyStatus(userId, data) {
  const eventId = String(data.eventId || '');
  const me = await resolveUser(userId);
  if (!me) return ok({ marker: null, mySubmit: null, counts: null });
  const mr = await db.collection(MARKERS).where({ userId: me._id, eventId }).limit(1).get().catch(() => null);
  const marker = mr && mr.data && mr.data[0] ? {
    _id: mr.data[0]._id, status: mr.data[0].status, group: mr.data[0].group || '',
    paid: !!mr.data[0].paid, recordId: mr.data[0].recordId || '',
    emergencyContact: mr.data[0].emergencyContact || '',
  } : null;
  const sr = await db.collection(SUBMITS).where({ userId: me._id, eventId })
    .orderBy('createTime', 'desc').limit(1).get().catch(() => null);
  const s0 = sr && sr.data && sr.data[0];
  const mySubmit = s0 ? {
    _id: s0._id, status: s0.status, result: s0.result, paceText: s0.paceText,
    reviewNote: s0.reviewNote || '', retryCount: s0.retryCount || 0,
  } : null;
  const c1 = await db.collection(SUBMITS).where({ eventId, status: 'approved' }).count().catch(() => ({ total: 0 }));
  const c2 = await db.collection(SUBMITS).where({ eventId, status: 'pending' }).count().catch(() => ({ total: 0 }));
  const c3 = await countActiveSignups(eventId);
  return ok({
    marker, mySubmit,
    counts: { approved: c1.total, pending: c2.total, signups: c3 },
  });
}

exports.main = async (event) => {
  const { action = '', userId = '' } = event || {};
  const data = event || {};
  try {
    switch (action) {
      case 'createEvent': return await actionCreateEvent(userId, data);
      case 'updateEvent': return await actionUpdateEvent(userId, data);
      case 'deleteEvent': return await actionDeleteEvent(userId, data);
      case 'signup': return await actionSignup(userId, data);
      case 'quit': return await actionQuit(userId, data);
      case 'listSignups': return await actionListSignups(userId, data);
      case 'markPaid': return await actionMarkPaid(userId, data);
      case 'submitResult': return await actionSubmitResult(userId, data);
      case 'reviewResult': return await actionReviewResult(userId, data);
      case 'pendingResults': return await actionPendingResults(userId, data);
      case 'myResults': return await actionMyResults(userId, data);
      case 'onlineRank': return await actionOnlineRank(userId, data);
      case 'myStatus': return await actionMyStatus(userId, data);
      default: return fail('未知操作');
    }
  } catch (e) {
    // 不打印完整对象，避免把敏感信息带进日志
    return fail('操作失败：' + (e && e.message ? e.message.slice(0, 80) : '未知错误'));
  }
};
