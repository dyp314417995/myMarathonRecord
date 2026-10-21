// cloudfunctions/winterTraining/index.js - 冬训营模块
// 所有时间判断均使用服务器时间（Asia/Shanghai），周一为一周起点
// 角色：管理组(super_admin) / 队长 leader / 教练 coach / 队员 member
// 一人一条报名记录（winter_member 以 userId 作 _id，天然唯一）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const TZ_OFFSET = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const CONFIG_ID = 'config';

const ROLE_TEXT = { member: '队员', leader: '队长', coach: '教练' };
const APPLY_STATUS_TEXT = { pending: '待审核', approved: '已通过', rejected: '已驳回', 'quit-suggested': '建议退出', quit: '已退出' };
const FINE_TEXT = { due: '应发', paid: '已发', unpaid: '未发' };

// ---------- 工具 ----------
function fmtDate(d) {
  const t = new Date(d.getTime() + TZ_OFFSET);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}
function addDays(dateStr, delta) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return fmtDate(new Date(Date.UTC(y, m - 1, d) + delta * DAY_MS - TZ_OFFSET));
}
function diffDays(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / DAY_MS);
}
function todayStr() { return fmtDate(new Date()); }
// 周一为一周起点
function mondayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=周日
  const back = dow === 0 ? 6 : dow - 1;
  return addDays(dateStr, -back);
}
function toNum(v) { const n = Number(v); return isNaN(n) ? 0 : n; }
function ok(data) { return { ok: true, ...data }; }
function fail(msg, extra) { return { ok: false, error: msg, ...(extra || {}) }; }

async function ensureCollections() {
  const names = ['winter_config', 'winter_group', 'winter_member', 'winter_kpi_range',
    'winter_checkin', 'winter_weekly', 'winter_schedule', 'winter_fine', 'winter_log'];
  for (const n of names) {
    try { await db.createCollection(n); } catch (e) { /* 已存在 */ }
  }
}

// 获取当前用户 userId（未注册返回空）
async function getUserId() {
  const ctx = cloud.getWXContext();
  const openid = ctx && ctx.OPENID;
  if (!openid) return '';
  let res = await db.collection('users').where({ _openid: openid }).limit(1).get().catch(() => null);
  if (res && res.data && res.data.length) return res.data[0]._id;
  res = await db.collection('users').where({ openid }).limit(1).get().catch(() => null);
  return res && res.data && res.data.length ? res.data[0]._id : '';
}

async function getUser(userId) {
  if (!userId) return null;
  const r = await db.collection('users').doc(userId).get().catch(() => null);
  return r && r.data ? r.data : null;
}

async function getConfig() {
  let r = await db.collection('winter_config').doc(CONFIG_ID).get().catch(() => null);
  if (r && r.data) return r.data;
  const def = {
    _id: CONFIG_ID,
    phase: 'closed',              // closed | trial | formal | holiday
    signupOpen: true,
    title: '冬训营',
    subtitle: '一起练，跑过这个冬天',
    intro: '冬训营为跑团冬季集中训练活动，按组分队、设定目标、每日打卡互审、每周结算。请仔细阅读规则后再报名。',
    startMonday: '',              // 冬训第一周周一 YYYY-MM-DD
    totalWeeks: 12,
    holidayWeeks: [],             // 春节周（冻结考核）
    fee: { entry: 50, coach: 30, pool: 20 },
    finePerWeek: 20,
    finePackets: 1,
    autoApproveMember: true,      // 队员自动通过
    extraAdminIds: [],            // 额外管理组成员
    rulesText: '',
    updatedAt: new Date(),
  };
  await db.collection('winter_config').add({ data: def }).catch(() => {});
  return def;
}

async function isSuperAdmin(userId) {
  if (!userId) return false;
  const cfg = await getConfig();
  if ((cfg.extraAdminIds || []).indexOf(userId) >= 0) return true;
  const u = await getUser(userId);
  return !!(u && u.role === 'super_admin');
}

// 当前周次下标（1 起算），未到开营周返回 0
function calcWeekIndex(cfg) {
  if (!cfg.startMonday) return 0;
  const curMonday = mondayOf(todayStr());
  return Math.floor(diffDays(curMonday, cfg.startMonday) / 7) + 1;
}
function isHolidayWeek(cfg, weekIndex) {
  return (cfg.holidayWeeks || []).indexOf(weekIndex) >= 0;
}

// 留痕日志（调组/伤病/建组/开关等后台操作）
async function saveLog(data) {
  await db.collection('winter_log').add({ data: { ...data, createTime: new Date() } }).catch(() => {});
}

// 惰性处理逾期未审：周一 18:00 后仍未审核的打卡自动通过
async function autoApproveOverdue(groupId) {
  const now = new Date();
  const bjNow = new Date(now.getTime() + TZ_OFFSET);
  const dow = bjNow.getUTCDay();       // 1=周一
  const hour = bjNow.getUTCHours();
  const pastMondayDeadline = dow > 1 || (dow === 1 && hour >= 18);
  if (!pastMondayDeadline) return 0;
  // 上一周（含更早）仍未审核的记录自动通过
  const cutoff = addDays(mondayOf(todayStr()), -1); // 上周日
  const res = await db.collection('winter_checkin').where({
    status: 'pending',
    date: _.lte(cutoff),
  }).limit(500).get().catch(() => null);
  const list = (res && res.data) || [];
  let n = 0;
  for (const c of list) {
    if (groupId && c.groupId !== groupId) continue;
    await db.collection('winter_checkin').doc(c._id).update({
      data: { status: 'approved', reviewerId: 'system', autoApproved: true, reviewTime: new Date(), reviewNote: '逾期未审，默认通过' },
    }).catch(() => {});
    n++;
  }
  return n;
}

// 取某组当前生效的 KPI 区间
async function getKpiRange(groupId) {
  const r = await db.collection('winter_kpi_range').where({ groupId })
    .orderBy('effectiveWeek', 'desc').orderBy('createTime', 'desc').limit(1).get().catch(() => null);
  return r && r.data && r.data.length ? r.data[0] : null;
}

// ---------- 通用读取 ----------
async function getMyMember(userId) {
  if (!userId) return null;
  const r = await db.collection('winter_member').doc(userId).get().catch(() => null);
  return r && r.data ? r.data : null;
}

async function getMemberListOfGroup(groupId) {
  const r = await db.collection('winter_member').where({ groupId, status: _.in(['approved', 'quit-suggested']) })
    .limit(200).get().catch(() => null);
  return (r && r.data) || [];
}

// 组装成员展示信息（昵称/头像）
async function decorateMembers(list) {
  const ids = [...new Set(list.map(m => m.userId).filter(Boolean))];
  const uMap = {};
  for (const id of ids) {
    const u = await getUser(id);
    if (u) uMap[id] = u;
  }
  return list.map(m => ({
    _id: m._id,
    userId: m.userId,
    nickName: (uMap[m.userId] && (uMap[m.userId].nickName || uMap[m.userId].nickname)) || m.nickName || '未设置昵称',
    avatarUrl: (uMap[m.userId] && uMap[m.userId].avatarUrl) || '',
    role: m.role,
    roleText: ROLE_TEXT[m.role] || '队员',
    kpiType: m.kpiType || '',
    kpiValue: m.kpiValue || 0,
    continuousFailWeeks: m.continuousFailWeeks || 0,
    status: m.status,
    remark: m.remark || '',
    feeStatus: m.feeStatus || 'unpaid',
    joinTime: m.joinTime || m.createTime || null,
  }));
}

// ==================== ACTION 实现 ====================

// 首页聚合：配置 + 我的报名 + 我的组 + KPI 区间 + 今日打卡 + 待审数量
async function actionBootstrap(userId) {
  const cfg = await getConfig();
  const isAdmin = await isSuperAdmin(userId);
  const member = await getMyMember(userId);
  const weekIndex = calcWeekIndex(cfg);
  const frozen = cfg.phase === 'holiday' || isHolidayWeek(cfg, weekIndex);

  const result = {
    cfg: {
      phase: cfg.phase, signupOpen: cfg.signupOpen, title: cfg.title, subtitle: cfg.subtitle,
      intro: cfg.intro, startMonday: cfg.startMonday, totalWeeks: cfg.totalWeeks,
      fee: cfg.fee, rulesText: cfg.rulesText,
    },
    weekIndex, frozen,
    isAdmin,
    joined: !!member,
    member: null, group: null, kpiRange: null, todayCheckin: null, pendingCount: 0, myRole: '',
  };
  if (!member) return ok(result);

  result.member = {
    role: member.role, roleText: ROLE_TEXT[member.role] || '',
    status: member.status, statusText: APPLY_STATUS_TEXT[member.status] || member.status,
    kpiType: member.kpiType || '', kpiValue: member.kpiValue || 0,
    continuousFailWeeks: member.continuousFailWeeks || 0,
    groupId: member.groupId, feeStatus: member.feeStatus || 'unpaid',
    nickName: member.nickName || '', target: member.target || '',
  };
  result.myRole = member.role;
  if (member.groupId) {
    const g = await db.collection('winter_group').doc(member.groupId).get().catch(() => null);
    result.group = g && g.data ? { _id: g.data._id, name: g.data.name, desc: g.data.desc || '', emblem: g.data.emblem || '' } : null;
    result.kpiRange = await getKpiRange(member.groupId);
  }
  const today = todayStr();
  const cr = await db.collection('winter_checkin').where({ userId, date: today }).limit(1).get().catch(() => null);
  result.todayCheckin = cr && cr.data && cr.data.length ? cr.data[0] : null;

  if (member.role === 'leader' || member.role === 'coach') {
    await autoApproveOverdue(member.groupId);
    const pr = await db.collection('winter_checkin').where({
      groupId: member.groupId, status: 'pending', userId: _.neq(userId),
    }).count().catch(() => null);
    result.pendingCount = pr ? pr.total : 0;
  }
  return ok(result);
}

// 介绍页数据（组别列表 + 规则）
async function actionGetIntro() {
  const cfg = await getConfig();
  const gRes = await db.collection('winter_group').orderBy('sort', 'asc').limit(50).get().catch(() => null);
  const groups = (gRes && gRes.data) || [];
  // 各组人数
  const counts = {};
  for (const g of groups) {
    const c = await db.collection('winter_member').where({ groupId: g._id, status: 'approved' }).count().catch(() => ({ total: 0 }));
    counts[g._id] = c.total || 0;
  }
  // 各组负责人
  const staffRes = await db.collection('winter_member').where({ status: 'approved', role: _.in(['leader', 'coach']) }).limit(200).get().catch(() => null);
  const staffMap = {};
  for (const m of ((staffRes && staffRes.data) || [])) {
    if (!staffMap[m.groupId]) staffMap[m.groupId] = { leader: [], coach: [] };
    const u = await getUser(m.userId);
    const name = (u && (u.nickName || u.nickname)) || m.nickName || '待任命';
    staffMap[m.groupId][m.role === 'leader' ? 'leader' : 'coach'].push(name);
  }
  return ok({
    cfg: {
      phase: cfg.phase, signupOpen: cfg.signupOpen, title: cfg.title, subtitle: cfg.subtitle,
      intro: cfg.intro, fee: cfg.fee, rulesText: cfg.rulesText, totalWeeks: cfg.totalWeeks,
    },
    groups: groups.map(g => ({
      _id: g._id, name: g.name, desc: g.desc || '', emblem: g.emblem || '',
      capacity: g.capacity || 0, open: g.open !== false,
      memberCount: counts[g._id] || 0,
      leaders: (staffMap[g._id] && staffMap[g._id].leader) || [],
      coaches: (staffMap[g._id] && staffMap[g._id].coach) || [],
    })),
  });
}

// 提交报名（一人一次）
async function actionSubmitApply(userId, data) {
  const cfg = await getConfig();
  if (cfg.phase === 'closed') return fail('冬训营暂未开放报名');
  if (!cfg.signupOpen) return fail('报名通道已关闭');
  if (!userId) return fail('请先登录');
  const nickName = String(data.nickName || '').trim();
  const groupId = String(data.groupId || '').trim();
  const role = String(data.role || 'member');
  if (!nickName) return fail('请填写昵称');
  if (!groupId) return fail('请选择组别');
  if (!['member', 'leader', 'coach'].includes(role)) return fail('角色不合法');

  const exist = await getMyMember(userId);
  if (exist) return fail('你已报名，不可重复提交');

  const g = await db.collection('winter_group').doc(groupId).get().catch(() => null);
  if (!g || !g.data) return fail('组别不存在');
  if (g.data.open === false) return fail('该组别未开放报名');
  if (g.data.capacity) {
    const cnt = await db.collection('winter_member').where({ groupId, status: _.in(['approved', 'pending']) }).count().catch(() => ({ total: 0 }));
    if ((cnt.total || 0) >= g.data.capacity) {
      if (!data.acceptAdjust) return fail('该组别人数已满，可勾选接受调剂');
    }
  }
  // 同一组只能有一名队长/一名教练（开营检查要求）
  if (role !== 'member') {
    const dup = await db.collection('winter_member').where({ groupId, role, status: _.in(['approved', 'pending']) }).count().catch(() => ({ total: 0 }));
    if ((dup.total || 0) > 0) return fail(`该组别已有${ROLE_TEXT[role]}申请，请更换组别或角色`);
  }

  // 队员自动通过；队长/教练需管理组任命
  const autoPass = role === 'member' && cfg.autoApproveMember;
  const record = {
    _id: userId,
    userId,
    nickName,
    recentResult: String(data.recentResult || ''),
    target: String(data.target || ''),
    groupId,
    role,
    reason: String(data.reason || ''),
    acceptAdjust: !!data.acceptAdjust,
    status: autoPass ? 'approved' : 'pending',
    kpiType: '',
    kpiValue: 0,
    continuousFailWeeks: 0,
    feeStatus: 'unpaid',
    createTime: new Date(),
    updateTime: new Date(),
  };
  await db.collection('winter_member').add({ data: record });
  if (autoPass) {
    await saveLog({ type: 'apply', action: 'auto-approve', operatorId: userId, targetUserId: userId, detail: `报名${g.data.name}，队员自动通过` });
  }
  return ok({ status: record.status, needReview: record.status === 'pending' });
}

// 我的组（名单 + 区间 + 我的 KPI）
async function actionGetMyGroup(userId) {
  const member = await getMyMember(userId);
  if (!member) return fail('尚未报名');
  const g = await db.collection('winter_group').doc(member.groupId).get().catch(() => null);
  const group = g && g.data ? { _id: g.data._id, name: g.data.name, desc: g.data.desc || '', emblem: g.data.emblem || '', capacity: g.data.capacity || 0 } : null;
  const raw = await getMemberListOfGroup(member.groupId);
  const members = await decorateMembers(raw);
  const kpiRange = await getKpiRange(member.groupId);
  const cfg = await getConfig();
  const weekIndex = calcWeekIndex(cfg);
  return ok({
    group,
    members: members.sort((a, b) => {
      const ord = { leader: 0, coach: 1, member: 2 };
      return (ord[a.role] || 9) - (ord[b.role] || 9);
    }),
    kpiRange,
    me: {
      role: member.role, roleText: ROLE_TEXT[member.role] || '',
      kpiType: member.kpiType || '', kpiValue: member.kpiValue || 0,
      continuousFailWeeks: member.continuousFailWeeks || 0,
      status: member.status, remark: member.remark || '',
    },
    weekIndex,
    frozen: cfg.phase === 'holiday' || isHolidayWeek(cfg, weekIndex),
  });
}

// 教练：设定 KPI 区间（保存即生效）
async function actionSetKpiRange(userId, data) {
  const member = await getMyMember(userId);
  if (!member) return fail('尚未报名');
  if (member.role !== 'coach') return fail('仅教练可设定 KPI 区间');
  if (member.status !== 'approved') return fail('你的报名尚未通过');
  const type = data.type === 'attendance' ? 'attendance' : 'distance';
  const min = toNum(data.min), max = toNum(data.max), minDuration = toNum(data.minDuration);
  if (min <= 0 || max <= 0) return fail('请填写有效的区间数值');
  if (max < min) return fail('上限不能小于下限');
  const cfg = await getConfig();
  const weekIndex = calcWeekIndex(cfg);
  const range = {
    groupId: member.groupId,
    type,
    min, max, minDuration,
    effectiveWeek: Math.max(1, weekIndex),
    coachId: userId,
    createTime: new Date(),
  };
  await db.collection('winter_kpi_range').add({ data: range });
  await saveLog({ type: 'kpi-range', action: 'publish', operatorId: userId, groupId: member.groupId, detail: `${type === 'distance' ? '跑量' : '出勤'} ${min}~${max}` });
  return ok({ range });
}

// 队员：区间内填报 KPI（自动通过，越界拒绝）
async function actionSubmitKpi(userId, data) {
  const member = await getMyMember(userId);
  if (!member) return fail('尚未报名');
  if (member.status !== 'approved') return fail('报名未通过，不可填报');
  const range = await getKpiRange(member.groupId);
  if (!range) return fail('教练尚未设定 KPI 区间');
  const type = String(data.kpiType || range.type);
  if (type !== range.type) return fail(`本组 KPI 类型为${range.type === 'distance' ? '跑量' : '出勤'}，不可更改`);
  const value = toNum(data.kpiValue);
  if (value < range.min || value > range.max) {
    return fail(`KPI 需在 ${range.min} ~ ${range.max} 之间`);
  }
  await db.collection('winter_member').doc(userId).update({
    data: { kpiType: type, kpiValue: value, updateTime: new Date() },
  });
  return ok({ kpiType: type, kpiValue: value });
}

// 每日打卡
async function actionDoCheckin(userId, data) {
  const cfg = await getConfig();
  if (cfg.phase === 'closed') return fail('冬训营未开放');
  const member = await getMyMember(userId);
  if (!member) return fail('尚未报名');
  if (member.status !== 'approved' && member.status !== 'quit-suggested') return fail('报名未通过');
  if (!member.kpiType || !member.kpiValue) return fail('请先填报本周 KPI');

  const date = data.date || todayStr();
  const today = todayStr();
  if (diffDays(today, date) > 0) return fail('不能给未来的日期打卡');
  if (diffDays(today, date) > 7) return fail('仅可补录最近 7 天的打卡');

  const imageFileID = String((data.imageFileID || data.image || '')).trim();
  const distance = toNum(data.distance);
  const duration = toNum(data.duration);
  const note = String(data.note || '').trim();
  if (!imageFileID) return fail('请上传一张跑步记录截图');
  if (member.kpiType === 'distance' && distance <= 0) return fail('请填写本次跑量（公里）');
  if (member.kpiType === 'attendance' && duration <= 0) return fail('请填写本次时长（分钟）');

  // 单次最低时长校验
  const range = await getKpiRange(member.groupId);
  if (range && range.minDuration && duration > 0 && duration < range.minDuration) {
    return fail(`单次训练时长不得低于 ${range.minDuration} 分钟`);
  }

  const exist = await db.collection('winter_checkin').where({ userId, date }).limit(1).get().catch(() => null);
  const weekIndex = Math.floor(diffDays(mondayOf(date), cfg.startMonday) / 7) + 1;
  if (weekIndex < 1) return fail('不在冬训周期内');

  const payload = {
    userId, groupId: member.groupId, date, weekIndex,
    monday: mondayOf(date),
    imageFileID, distance, duration, note,
    kpiType: member.kpiType,
    updateTime: new Date(),
  };
  if (exist && exist.data && exist.data.length) {
    if (exist.data[0].status === 'approved') return fail('该日期打卡已通过审核，不可修改');
    payload.status = 'pending';
    payload.reviewerId = '';
    payload.reviewNote = '';
    await db.collection('winter_checkin').doc(exist.data[0]._id).update({ data: payload });
    return ok({ id: exist.data[0]._id, updated: true });
  }
  payload.status = 'pending';
  payload.createTime = new Date();
  const addRes = await db.collection('winter_checkin').add({ data: payload });
  return ok({ id: addRes._id });
}

// 我的打卡记录
async function actionMyCheckins(userId, data) {
  const cfg = await getConfig();
  const weekIndex = data.weekIndex ? Number(data.weekIndex) : calcWeekIndex(cfg);
  const member = await getMyMember(userId);
  if (!member) return fail('尚未报名');
  const r = await db.collection('winter_checkin').where({ userId, weekIndex })
    .orderBy('date', 'asc').limit(100).get().catch(() => null);
  return ok({ weekIndex, list: (r && r.data) || [] });
}

// 待审核列表（仅队长/教练可见本组，排除自己）
async function actionPendingReview(userId, data) {
  const member = await getMyMember(userId);
  if (!member) return fail('尚未报名');
  if (!['leader', 'coach'].includes(member.role)) return fail('仅队长/教练可审核');
  await autoApproveOverdue(member.groupId);
  const r = await db.collection('winter_checkin').where({
    groupId: member.groupId, status: 'pending', userId: _.neq(userId),
  }).orderBy('date', 'desc').limit(100).get().catch(() => null);
  const list = (r && r.data) || [];
  const decorated = [];
  for (const c of list) {
    const u = await getUser(c.userId);
    decorated.push({
      ...c,
      nickName: (u && (u.nickName || u.nickname)) || '未知',
      avatarUrl: (u && u.avatarUrl) || '',
    });
  }
  return ok({ list: decorated, myRole: member.role });
}

// 审核打卡（队长/教练互审；单人管理自动通过由 doCheckin 侧处理）
async function actionReviewCheckin(userId, data) {
  const member = await getMyMember(userId);
  if (!member) return fail('尚未报名');
  const isAdmin = await isSuperAdmin(userId);
  if (!['leader', 'coach'].includes(member.role) && !isAdmin) return fail('无审核权限');
  const id = String(data.id || '');
  const pass = data.pass === true || String(data.pass) === 'true';
  const note = String(data.note || '').trim();
  if (!id) return fail('缺少打卡记录');
  if (!pass && !note) return fail('驳回需填写原因');
  const cRes = await db.collection('winter_checkin').doc(id).get().catch(() => null);
  if (!cRes || !cRes.data) return fail('打卡记录不存在');
  const c = cRes.data;
  if (c.userId === userId) return fail('不能审核自己的打卡');
  if (!isAdmin && (!member.groupId || c.groupId !== member.groupId)) return fail('只能审核本组打卡');
  // 互审：队长只能审队员+教练，教练只能审队员+队长；管理组不受限
  if (!isAdmin && ['leader', 'coach'].includes(member.role)) {
    const target = await getMyMember(c.userId);
    if (target && target.role === member.role) return fail('队长/教练需互审，不可审同角色');
  }
  await db.collection('winter_checkin').doc(id).update({
    data: {
      status: pass ? 'approved' : 'rejected',
      reviewerId: userId,
      reviewNote: note,
      reviewTime: new Date(),
    },
  });
  return ok({ status: pass ? 'approved' : 'rejected' });
}

// 周统计 + 榜单
async function actionWeeklyStats(userId, data) {
  const cfg = await getConfig();
  const weekIndex = data.weekIndex ? Number(data.weekIndex) : calcWeekIndex(cfg);
  const myMember = await getMyMember(userId);
  const groupId = data.groupId || (myMember && myMember.groupId) || '';
  const frozen = cfg.phase === 'holiday' || isHolidayWeek(cfg, weekIndex);

  // 本组本周打卡汇总
  const memberList = groupId ? await getMemberListOfGroup(groupId) : (myMember ? await getMemberListOfGroup(myMember.groupId) : []);
  const gid = groupId || (myMember && myMember.groupId) || '';
  const stats = [];
  let sumRate = 0, completedCnt = 0;
  for (const m of memberList) {
    const cr = await db.collection('winter_checkin').where({ userId: m.userId, weekIndex }).limit(100).get().catch(() => null);
    const list = ((cr && cr.data) || []).filter(c => c.status === 'approved');
    const totalDistance = list.reduce((s, c) => s + toNum(c.distance), 0);
    const totalDuration = list.reduce((s, c) => s + toNum(c.duration), 0);
    const days = new Set(list.map(c => c.date)).size;
    const target = toNum(m.kpiValue);
    let actual = 0, rate = 0;
    if (target > 0) {
      actual = m.kpiType === 'attendance' ? days : totalDistance;
      rate = Math.min(1, actual / target);
    }
    const completed = frozen ? true : (target > 0 && rate >= 1);
    if (completed) completedCnt++;
    sumRate += rate;
    const u = await getUser(m.userId);
    stats.push({
      userId: m.userId,
      nickName: (u && (u.nickName || u.nickname)) || m.nickName || '未知',
      avatarUrl: (u && u.avatarUrl) || '',
      role: m.role, roleText: ROLE_TEXT[m.role] || '',
      kpiType: m.kpiType, target, actual, days, totalDistance, totalDuration,
      rate: Math.round(rate * 100),
      completed,
      continuousFailWeeks: m.continuousFailWeeks || 0,
    });
  }
  const avgRate = memberList.length ? Math.round((sumRate / memberList.length) * 100) : 0;

  // 队伍榜（各组人均完成率）
  const gRes = await db.collection('winter_group').orderBy('sort', 'asc').limit(50).get().catch(() => null);
  const teamRank = [];
  for (const g of ((gRes && gRes.data) || [])) {
    const ms = await getMemberListOfGroup(g._id);
    if (!ms.length) { teamRank.push({ groupId: g._id, name: g.name, emblem: g.emblem || '', avgRate: 0, memberCount: 0, completedCount: 0 }); continue; }
    let sum = 0, done = 0;
    for (const m of ms) {
      const cr = await db.collection('winter_checkin').where({ userId: m.userId, weekIndex }).limit(100).get().catch(() => null);
      const list = ((cr && cr.data) || []).filter(c => c.status === 'approved');
      const totalDistance = list.reduce((s, c) => s + toNum(c.distance), 0);
      const days = new Set(list.map(c => c.date)).size;
      const target = toNum(m.kpiValue);
      let rate = 0;
      if (target > 0) rate = Math.min(1, (m.kpiType === 'attendance' ? days : totalDistance) / target);
      sum += rate;
      if (frozen || rate >= 1) done++;
    }
    teamRank.push({
      groupId: g._id, name: g.name, emblem: g.emblem || '',
      avgRate: Math.round((sum / ms.length) * 100),
      memberCount: ms.length, completedCount: done,
    });
  }
  teamRank.sort((a, b) => b.avgRate - a.avgRate);

  return ok({
    weekIndex, frozen,
    groupId: gid,
    myUserId: userId,
    personal: stats.sort((a, b) => b.rate - a.rate),
    myStat: stats.find(s => s.userId === userId) || null,
    groupAvgRate: avgRate,
    completedCount: completedCnt,
    teamRank,
  });
}

// 教练发布课表（三档建议）
async function actionPublishSchedule(userId, data) {
  const member = await getMyMember(userId);
  if (!member) return fail('尚未报名');
  if (member.role !== 'coach') return fail('仅教练可发布课表');
  if (member.status !== 'approved') return fail('报名未通过');
  const cfg = await getConfig();
  const weekIndex = Number(data.weekIndex) || calcWeekIndex(cfg);
  const tiers = Array.isArray(data.tiers) ? data.tiers : [];
  const payload = {
    groupId: member.groupId, weekIndex,
    a: String((tiers[0] || {}).content || data.a || ''),
    b: String((tiers[1] || {}).content || data.b || ''),
    c: String((tiers[2] || {}).content || data.c || ''),
    advice: String(data.advice || ''),
    publisherId: userId,
    readBy: [],
    updateTime: new Date(),
  };
  const exist = await db.collection('winter_schedule').where({ groupId: member.groupId, weekIndex }).limit(1).get().catch(() => null);
  if (exist && exist.data && exist.data.length) {
    await db.collection('winter_schedule').doc(exist.data[0]._id).update({ data: payload });
    return ok({ id: exist.data[0]._id, updated: true });
  }
  payload.createTime = new Date();
  const r = await db.collection('winter_schedule').add({ data: payload });
  return ok({ id: r._id });
}

async function actionGetSchedule(userId, data) {
  const cfg = await getConfig();
  const weekIndex = Number(data.weekIndex) || calcWeekIndex(cfg);
  const member = await getMyMember(userId);
  const groupId = member ? member.groupId : String(data.groupId || '');
  if (!groupId) return fail('尚未报名且未指定组别');
  const r = await db.collection('winter_schedule').where({ groupId, weekIndex }).limit(1).get().catch(() => null);
  const s = r && r.data && r.data.length ? r.data[0] : null;
  let publisherName = '';
  if (s) {
    const u = await getUser(s.publisherId);
    publisherName = (u && (u.nickName || u.nickname)) || '';
  }
  return ok({
    weekIndex,
    schedule: s ? {
      ...s,
      read: (s.readBy || []).indexOf(userId) >= 0,
      readCount: (s.readBy || []).length,
      publisherName,
    } : null,
  });
}

async function actionReadSchedule(userId, data) {
  const id = String(data.id || '');
  if (!id) return fail('缺少课表');
  const r = await db.collection('winter_schedule').doc(id).get().catch(() => null);
  if (!r || !r.data) return fail('课表不存在');
  const readBy = r.data.readBy || [];
  if (readBy.indexOf(userId) < 0) readBy.push(userId);
  await db.collection('winter_schedule').doc(id).update({ data: { readBy } });
  return ok({ read: true, readCount: readBy.length });
}

// 我的档案：KPI / 罚金 / 费用 / 周历史
async function actionMyProfile(userId) {
  const member = await getMyMember(userId);
  if (!member) return fail('尚未报名');
  const cfg = await getConfig();
  const weekIndex = calcWeekIndex(cfg);
  const fines = await db.collection('winter_fine').where({ userId }).orderBy('weekIndex', 'desc').limit(50).get().catch(() => null);
  const weeklies = await db.collection('winter_weekly').where({ userId }).orderBy('weekIndex', 'desc').limit(50).get().catch(() => null);
  return ok({
    me: {
      nickName: member.nickName, role: member.role, roleText: ROLE_TEXT[member.role] || '',
      groupId: member.groupId, kpiType: member.kpiType, kpiValue: member.kpiValue,
      continuousFailWeeks: member.continuousFailWeeks || 0,
      status: member.status, statusText: APPLY_STATUS_TEXT[member.status] || member.status,
      remark: member.remark || '', feeStatus: member.feeStatus || 'unpaid',
    },
    fee: cfg.fee,
    totalFee: toNum(cfg.fee.entry) + toNum(cfg.fee.coach) + toNum(cfg.fee.pool),
    weekIndex,
    fines: ((fines && fines.data) || []).map(f => ({ ...f, statusText: FINE_TEXT[f.status] || f.status })),
    weekly: (weeklies && weeklies.data) || [],
  });
}

// ==================== 管理组后台 ====================
async function requireAdmin(userId) {
  if (!(await isSuperAdmin(userId))) throw new Error('无管理组权限');
}

// 后台概览
async function actionAdminOverview(userId) {
  await requireAdmin(userId);
  const cfg = await getConfig();
  const weekIndex = calcWeekIndex(cfg);
  const all = await db.collection('winter_member').limit(500).get().catch(() => null);
  const members = (all && all.data) || [];
  const pending = members.filter(m => m.status === 'pending');
  const approved = members.filter(m => m.status === 'approved');
  const quitSuggested = members.filter(m => m.status === 'quit-suggested');

  const gRes = await db.collection('winter_group').orderBy('sort', 'asc').limit(50).get().catch(() => null);
  const groups = [];
  for (const g of ((gRes && gRes.data) || [])) {
    const gm = members.filter(m => m.groupId === g._id && ['approved', 'quit-suggested'].includes(m.status));
    const leader = gm.find(m => m.role === 'leader');
    const coach = gm.find(m => m.role === 'coach');
    const range = await getKpiRange(g._id);
    groups.push({
      _id: g._id, name: g.name, desc: g.desc || '', emblem: g.emblem || '',
      capacity: g.capacity || 0, open: g.open !== false, sort: g.sort || 0,
      memberCount: gm.length,
      leader: leader ? (await getUser(leader.userId) || {}).nickName || leader.nickName || '待任命' : '待任命',
      coach: coach ? (await getUser(coach.userId) || {}).nickName || coach.nickName || '待任命' : '待任命',
      ready: !!leader && !!coach,
      kpiRange: range ? `${range.type === 'distance' ? '跑量' : '出勤'} ${range.min}~${range.max}` : '未设定',
    });
  }
  // 本周打卡待审总数
  const pc = await db.collection('winter_checkin').where({ status: 'pending' }).count().catch(() => ({ total: 0 }));
  return ok({
    cfg: {
      phase: cfg.phase, signupOpen: cfg.signupOpen, startMonday: cfg.startMonday,
      totalWeeks: cfg.totalWeeks, holidayWeeks: cfg.holidayWeeks || [], fee: cfg.fee,
      finePerWeek: cfg.finePerWeek, finePackets: cfg.finePackets, intro: cfg.intro, rulesText: cfg.rulesText,
    },
    weekIndex,
    counts: {
      total: members.length, pending: pending.length, approved: approved.length,
      quitSuggested: quitSuggested.length, pendingCheckins: pc.total || 0,
    },
    groups,
  });
}

// 建组 / 编辑组
async function actionAdminSaveGroup(userId, data) {
  await requireAdmin(userId);
  const name = String(data.name || '').trim();
  if (!name) return fail('请填写组名');
  const payload = {
    name,
    desc: String(data.desc || '').trim(),
    emblem: String(data.emblem || '').trim(),
    capacity: toNum(data.capacity),
    open: data.open !== false,
    sort: toNum(data.sort),
    updateTime: new Date(),
  };
  if (data.id) {
    await db.collection('winter_group').doc(data.id).update({ data: payload });
    await saveLog({ type: 'group', action: 'update', operatorId: userId, groupId: data.id, detail: name });
    return ok({ id: data.id, updated: true });
  }
  // 同名保护
  const dup = await db.collection('winter_group').where({ name }).limit(1).get().catch(() => null);
  if (dup && dup.data && dup.data.length) return fail('该组名已存在');
  payload.createTime = new Date();
  const r = await db.collection('winter_group').add({ data: payload });
  await saveLog({ type: 'group', action: 'create', operatorId: userId, groupId: r._id, detail: name });
  return ok({ id: r._id });
}

// 报名审核列表
async function actionAdminApplies(userId, data) {
  await requireAdmin(userId);
  const status = String(data.status || 'pending');
  const r = await db.collection('winter_member').where({ status }).limit(200).get().catch(() => null);
  const list = (r && r.data) || [];
  const out = [];
  for (const m of list) {
    const u = await getUser(m.userId);
    const g = m.groupId ? await db.collection('winter_group').doc(m.groupId).get().catch(() => null) : null;
    out.push({
      _id: m._id, userId: m.userId,
      nickName: (u && (u.nickName || u.nickname)) || m.nickName || '未知',
      avatarUrl: (u && u.avatarUrl) || '',
      groupId: m.groupId, groupName: g && g.data ? g.data.name : '未指定',
      role: m.role, roleText: ROLE_TEXT[m.role] || '',
      recentResult: m.recentResult || '', target: m.target || '', reason: m.reason || '',
      acceptAdjust: !!m.acceptAdjust, createTime: m.createTime,
    });
  }
  return ok({ list: out });
}

// 审核报名 / 任命 / 调剂
async function actionAdminReviewApply(userId, data) {
  await requireAdmin(userId);
  const targetId = String(data.userId || data.id || '');
  const pass = data.pass === true || String(data.pass) === 'true';
  const groupId = String(data.groupId || '').trim();
  if (!targetId) return fail('缺少成员');
  const mRes = await db.collection('winter_member').doc(targetId).get().catch(() => null);
  if (!mRes || !mRes.data) return fail('报名记录不存在');
  const m = mRes.data;
  if (!pass) {
    await db.collection('winter_member').doc(targetId).update({
      data: { status: 'rejected', rejectReason: String(data.note || ''), updateTime: new Date() },
    });
    await saveLog({ type: 'apply', action: 'reject', operatorId: userId, targetUserId: targetId, detail: String(data.note || '') });
    return ok({ status: 'rejected' });
  }
  // 调剂到新组时校验容量与角色唯一
  const finalGroupId = groupId || m.groupId;
  const g = finalGroupId ? await db.collection('winter_group').doc(finalGroupId).get().catch(() => null) : null;
  if (g && g.data && g.data.capacity) {
    const cnt = await db.collection('winter_member').where({ groupId: finalGroupId, status: 'approved' }).count().catch(() => ({ total: 0 }));
    if ((cnt.total || 0) >= g.data.capacity) return fail('目标组别人数已满');
  }
  if (m.role !== 'member') {
    const dup = await db.collection('winter_member').where({ groupId: finalGroupId, role: m.role, status: 'approved' }).count().catch(() => ({ total: 0 }));
    if ((dup.total || 0) > 0) return fail(`目标组别已有${ROLE_TEXT[m.role]}`);
  }
  const updateData = { status: 'approved', groupId: finalGroupId, rejectReason: '', updateTime: new Date() };
  if (groupId && groupId !== m.groupId) updateData.adjusted = true;
  await db.collection('winter_member').doc(targetId).update({ data: updateData });
  await saveLog({
    type: 'apply', action: groupId && groupId !== m.groupId ? 'appoint-adjust' : 'appoint',
    operatorId: userId, targetUserId: targetId,
    detail: `${ROLE_TEXT[m.role]} → ${g && g.data ? g.data.name : finalGroupId}`,
  });
  return ok({ status: 'approved', groupId: finalGroupId });
}

// 成员列表（可按组筛选）
async function actionAdminMembers(userId, data) {
  await requireAdmin(userId);
  const where = {};
  if (data.groupId) where.groupId = data.groupId;
  if (data.status) where.status = data.status;
  const r = await db.collection('winter_member').where(Object.keys(where).length ? where : { status: _.exists(true) })
    .limit(500).get().catch(() => null);
  const list = (r && r.data) || [];
  const out = [];
  for (const m of list) {
    const u = await getUser(m.userId);
    const g = m.groupId ? await db.collection('winter_group').doc(m.groupId).get().catch(() => null) : null;
    out.push({
      _id: m._id, userId: m.userId,
      nickName: (u && (u.nickName || u.nickname)) || m.nickName || '未知',
      avatarUrl: (u && u.avatarUrl) || '',
      groupId: m.groupId, groupName: g && g.data ? g.data.name : '未分组',
      role: m.role, roleText: ROLE_TEXT[m.role] || '',
      status: m.status, statusText: APPLY_STATUS_TEXT[m.status] || m.status,
      kpiType: m.kpiType, kpiValue: m.kpiValue,
      continuousFailWeeks: m.continuousFailWeeks || 0,
      remark: m.remark || '', feeStatus: m.feeStatus || 'unpaid',
    });
  }
  // 组别列表供下拉
  const gRes = await db.collection('winter_group').orderBy('sort', 'asc').limit(50).get().catch(() => null);
  return ok({ list: out, groups: ((gRes && gRes.data) || []).map(g => ({ _id: g._id, name: g.name })) });
}

// 手动调组 / 伤病备注（留痕）
async function actionAdminTransfer(userId, data) {
  await requireAdmin(userId);
  const targetId = String(data.userId || '');
  const newGroupId = String(data.newGroupId || '').trim();
  const reason = String(data.reason || '').trim();
  const clearFail = data.clearFail === true || String(data.clearFail) === 'true';
  if (!targetId || !newGroupId) return fail('缺少成员或目标组别');
  if (!reason) return fail('请填写调整原因');
  const m = await getMyMember(targetId);
  if (!m) return fail('成员不存在');
  if (m.role !== 'member') return fail('仅队员可调整组别（队长/教练变更请先调整角色）');
  const g = await db.collection('winter_group').doc(newGroupId).get().catch(() => null);
  if (!g || !g.data) return fail('目标组别不存在');
  if (g.data.capacity) {
    const cnt = await db.collection('winter_member').where({ groupId: newGroupId, status: 'approved' }).count().catch(() => ({ total: 0 }));
    if ((cnt.total || 0) >= g.data.capacity) return fail('目标组别人数已满');
  }
  const updateData = { groupId: newGroupId, updateTime: new Date() };
  if (clearFail) updateData.continuousFailWeeks = 0;
  await db.collection('winter_member').doc(targetId).update({ data: updateData });
  // 备注写入（伤病/调整原因）
  if (data.saveRemark !== false) {
    await db.collection('winter_member').doc(targetId).update({
      data: { remark: reason, remarkTime: new Date() },
    }).catch(() => {});
  }
  await saveLog({
    type: 'transfer', action: 'move', operatorId: userId, targetUserId: targetId,
    fromGroupId: m.groupId, toGroupId: newGroupId,
    clearFail, remark: reason,
    effectiveDate: String(data.effectiveDate || todayStr()),
  });
  return ok({ groupId: newGroupId });
}

// 伤病 / 备注（不调组，仅备注）
async function actionAdminRemark(userId, data) {
  await requireAdmin(userId);
  const targetId = String(data.userId || '');
  const remark = String(data.remark || '').trim();
  if (!targetId) return fail('缺少成员');
  await db.collection('winter_member').doc(targetId).update({
    data: { remark, remarkTime: new Date(), updateTime: new Date() },
  });
  await saveLog({ type: 'remark', action: 'set', operatorId: userId, targetUserId: targetId, remark });
  return ok({ remark });
}

// 抽查：跨组查看打卡（可按状态/组筛选）
async function functionAdminCheckins(userId, data) {
  await requireAdmin(userId);
  const where = {};
  if (data.groupId) where.groupId = data.groupId;
  if (data.status) where.status = data.status;
  if (data.userId) where.userId = data.userId;
  if (data.weekIndex) where.weekIndex = Number(data.weekIndex);
  const r = await db.collection('winter_checkin').where(Object.keys(where).length ? where : { status: _.exists(true) })
    .orderBy('date', 'desc').limit(200).get().catch(() => null);
  const list = (r && r.data) || [];
  const out = [];
  for (const c of list) {
    const u = await getUser(c.userId);
    out.push({
      ...c,
      nickName: (u && (u.nickName || u.nickname)) || '未知',
      avatarUrl: (u && u.avatarUrl) || '',
    });
  }
  return ok({ list: out });
}

// 周结算：写周统计、更新连续未完成、生成罚金
async function actionAdminCalcWeek(userId, data) {
  await requireAdmin(userId);
  const cfg = await getConfig();
  const weekIndex = Number(data.weekIndex) || calcWeekIndex(cfg);
  if (weekIndex < 1) return fail('冬训尚未开始');
  await autoApproveOverdue('');
  const frozen = cfg.phase === 'holiday' || isHolidayWeek(cfg, weekIndex);
  const all = await db.collection('winter_member').where({ status: _.in(['approved', 'quit-suggested']) }).limit(500).get().catch(() => null);
  const members = (all && all.data) || [];

  let failCnt = 0, doneCnt = 0, fineTotal = 0;
  for (const m of members) {
    const cr = await db.collection('winter_checkin').where({ userId: m.userId, weekIndex }).limit(100).get().catch(() => null);
    const list = ((cr && cr.data) || []).filter(c => c.status === 'approved');
    const totalDistance = list.reduce((s, c) => s + toNum(c.distance), 0);
    const days = new Set(list.map(c => c.date)).size;
    const target = toNum(m.kpiValue);
    let actual = 0, rate = 0;
    if (target > 0) {
      actual = m.kpiType === 'attendance' ? days : totalDistance;
      rate = Math.min(1, actual / target);
    }
    const completed = frozen || (target > 0 && rate >= 1);
    // 更新连续未完成（春节周冻结）
    let continuousFailWeeks = m.continuousFailWeeks || 0;
    if (!frozen) {
      if (!completed && target > 0) continuousFailWeeks += 1;
      else if (completed) continuousFailWeeks = 0;
    }
    // 第 4 周标记「建议退出」
    let status = m.status;
    if (continuousFailWeeks >= 4 && status === 'approved') status = 'quit-suggested';
    await db.collection('winter_member').doc(m.userId).update({
      data: { continuousFailWeeks, status, updateTime: new Date() },
    });
    // 写周统计
    const exist = await db.collection('winter_weekly').where({ userId: m.userId, weekIndex }).limit(1).get().catch(() => null);
    const stat = {
      userId: m.userId, groupId: m.groupId, weekIndex,
      target, actual, rate: Math.round(rate * 100), completed,
      isHoliday: !!frozen, calcTime: new Date(),
    };
    if (exist && exist.data && exist.data.length) {
      await db.collection('winter_weekly').doc(exist.data[0]._id).update({ data: stat });
    } else {
      await db.collection('winter_weekly').add({ data: { ...stat, createTime: new Date() } });
    }
    // 罚金（仅未完成且非春节周）
    if (!completed && target > 0 && !frozen) {
      const fineExist = await db.collection('winter_fine').where({ userId: m.userId, weekIndex }).limit(1).get().catch(() => null);
      if (!(fineExist && fineExist.data && fineExist.data.length)) {
        await db.collection('winter_fine').add({
          data: {
            userId: m.userId, groupId: m.groupId, weekIndex,
            amount: toNum(cfg.finePerWeek), packets: toNum(cfg.finePackets),
            status: 'due', createTime: new Date(),
          },
        });
      }
      fineTotal += toNum(cfg.finePerWeek);
      failCnt++;
    } else if (completed) {
      doneCnt++;
    }
  }
  await saveLog({ type: 'weekly', action: 'calc', operatorId: userId, detail: `第${weekIndex}周结算：完成${doneCnt}人，未完成${failCnt}人，罚金${fineTotal}元` });
  return ok({ weekIndex, frozen, done: doneCnt, failed: failCnt, fineTotal });
}

// 阶段开关（试运行/正式/春节假期）
async function actionAdminSetPhase(userId, data) {
  await requireAdmin(userId);
  const phase = String(data.phase || '');
  if (!['closed', 'trial', 'formal', 'holiday'].includes(phase)) return fail('阶段值不合法');
  const update = { phase, updateTime: new Date() };
  if (data.signupOpen !== undefined) update.signupOpen = !!data.signupOpen;
  if (data.startMonday !== undefined) update.startMonday = String(data.startMonday || '');
  if (data.totalWeeks !== undefined) update.totalWeeks = Number(data.totalWeeks) || 12;
  if (data.holidayWeeks !== undefined) {
    update.holidayWeeks = Array.isArray(data.holidayWeeks) ? data.holidayWeeks.map(Number).filter(n => !isNaN(n)) : [];
  }
  if (data.finePerWeek !== undefined) update.finePerWeek = Number(data.finePerWeek) || 0;
  if (data.finePackets !== undefined) update.finePackets = Number(data.finePackets) || 0;
  if (data.intro !== undefined) update.intro = String(data.intro || '');
  if (data.rulesText !== undefined) update.rulesText = String(data.rulesText || '');
  if (data.fee !== undefined) update.fee = data.fee;
  await db.collection('winter_config').doc(CONFIG_ID).update({ data: update }).catch(async () => {
    await db.collection('winter_config').add({ data: { _id: CONFIG_ID, ...update } });
  });
  await saveLog({ type: 'phase', action: 'set', operatorId: userId, detail: phase });
  return ok({ phase });
}

// 费用与奖池
async function actionAdminFinance(userId, data) {
  await requireAdmin(userId);
  const cfg = await getConfig();
  const members = await db.collection('winter_member').where({ status: _.in(['approved', 'quit-suggested']) }).limit(500).get().catch(() => null);
  const list = (members && members.data) || [];
  const paid = list.filter(m => m.feeStatus === 'paid');
  const feeTotal = list.length * (toNum(cfg.fee.entry) + toNum(cfg.fee.coach) + toNum(cfg.fee.pool));
  const poolTotal = list.length * toNum(cfg.fee.pool);
  const fines = await db.collection('winter_fine').limit(500).get().catch(() => null);
  const fineList = (fines && fines.data) || [];
  const fineDue = fineList.filter(f => f.status === 'due').reduce((s, f) => s + toNum(f.amount), 0);
  const finePaid = fineList.filter(f => f.status === 'paid').reduce((s, f) => s + toNum(f.amount), 0);
  return ok({
    fee: cfg.fee, memberCount: list.length, paidCount: paid.length,
    feeTotal, poolTotal,
    fineDue, finePaid, fineList: fineList.map(f => ({ ...f, statusText: FINE_TEXT[f.status] || f.status })),
  });
}

// 更新缴费状态 / 罚金状态
async function actionAdminUpdateFinance(userId, data) {
  await requireAdmin(userId);
  if (data.userId && data.feeStatus) {
    await db.collection('winter_member').doc(data.userId).update({ data: { feeStatus: String(data.feeStatus), updateTime: new Date() } });
    return ok({ userId: data.userId, feeStatus: data.feeStatus });
  }
  if (data.fineId && data.status) {
    await db.collection('winter_fine').doc(data.fineId).update({ data: { status: String(data.status), updateTime: new Date() } });
    return ok({ fineId: data.fineId, status: data.status });
  }
  return fail('缺少参数');
}

// 退出确认（连续 4 周未完成）
async function actionAdminConfirmQuit(userId, data) {
  await requireAdmin(userId);
  const targetId = String(data.userId || '');
  const confirm = data.confirm === true || String(data.confirm) === 'true';
  if (!targetId) return fail('缺少成员');
  const update = confirm
    ? { status: 'quit', updateTime: new Date() }
    : { status: 'approved', continuousFailWeeks: 0, updateTime: new Date() };
  await db.collection('winter_member').doc(targetId).update({ data: update });
  await saveLog({ type: 'quit', action: confirm ? 'confirm' : 'revoke', operatorId: userId, targetUserId: targetId });
  return ok(update);
}

exports.main = async (event = {}) => {
  const action = String(event.action || '');
  const data = event.data || {};
  try {
    await ensureCollections();
    const userId = await getUserId();
    // 免登录 action
    if (action === 'intro') return await actionGetIntro();

    if (!userId) return fail('请先登录');

    switch (action) {
      // ---- 用户侧 ----
      case 'bootstrap': return await actionBootstrap(userId);
      case 'submitApply': return await actionSubmitApply(userId, data);
      case 'myGroup': return await actionGetMyGroup(userId);
      case 'setKpiRange': return await actionSetKpiRange(userId, data);
      case 'submitKpi': return await actionSubmitKpi(userId, data);
      case 'checkin': return await actionDoCheckin(userId, data);
      case 'myCheckins': return await actionMyCheckins(userId, data);
      case 'pendingReview': return await actionPendingReview(userId, data);
      case 'reviewCheckin': return await actionReviewCheckin(userId, data);
      case 'weeklyStats': return await actionWeeklyStats(userId, data);
      case 'publishSchedule': return await actionPublishSchedule(userId, data);
      case 'getSchedule': return await actionGetSchedule(userId, data);
      case 'readSchedule': return await actionReadSchedule(userId, data);
      case 'myProfile': return await actionMyProfile(userId);

      // ---- 管理组后台 ----
      case 'adminOverview': return await actionAdminOverview(userId);
      case 'adminSaveGroup': return await actionAdminSaveGroup(userId, data);
      case 'adminApplies': return await actionAdminApplies(userId, data);
      case 'adminReviewApply': return await actionAdminReviewApply(userId, data);
      case 'adminMembers': return await actionAdminMembers(userId, data);
      case 'adminTransfer': return await actionAdminTransfer(userId, data);
      case 'adminRemark': return await actionAdminRemark(userId, data);
      case 'adminCheckins': return await functionAdminCheckins(userId, data);
      case 'adminCalcWeek': return await actionAdminCalcWeek(userId, data);
      case 'adminSetPhase': return await actionAdminSetPhase(userId, data);
      case 'adminFinance': return await actionAdminFinance(userId);
      case 'adminUpdateFinance': return await actionAdminUpdateFinance(userId, data);
      case 'adminConfirmQuit': return await actionAdminConfirmQuit(userId, data);
      default: return fail('未知操作: ' + action);
    }
  } catch (err) {
    console.error('winterTraining error:', err);
    return fail(err.message || '服务异常');
  }
};
