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
// 缴费状态三态：paid 已缴费 / unpaid 未缴费 / free 免费（无需缴费）
const FEE_STATUS_SET = ['paid', 'unpaid', 'free'];
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
    'winter_checkin', 'winter_weekly', 'winter_kpi', 'winter_schedule', 'winter_fine', 'winter_log',
    'winter_staff'];
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
    title: '破冬行动',
    subtitle: '100 天能力组冬训 · 不卷跑量，只卷出现',
    intro: '「破冬行动」是九州战马联盟冬训管理组发起的百日能力组冬训：按全马目标分成 S/A/B/C/D/E/F/动起来 8 个组，每组即一队，由队长审核、教练定 KPI 区间与周课表。个人只在自己填报的 KPI 内被考核，不比绝对跑量、不排名配速。不要求你跑多快，只要求你每周出现。来，别冬眠。',
    startMonday: '2026-11-16',     // 正式开营周一（100 天到 2027-02-23）
    totalWeeks: 15,               // 第 1 周 11/16-11/22 … 第 15 周 2/22-2/28（结营日 2/23）
    holidayWeeks: [12, 13],       // 覆盖春节放假 2/5-2/11（第12周 2/1-2/7、第13周 2/8-2/14）
    scale: { target: 100, max: 150 }, // 规模：目标 100 人，上限 150 人
    fee: { entry: 50, coach: 30, pool: 20 },
    // 小红包提醒：按「连续未完成周数」取对应档位，超出取最后一档（20 元封顶）
    fineTiers: [5, 10, 20],
    finePackets: 5,               // 5 个拼手气；组内人少按「人数-1」发
    warnWeek: 1,                  // 正式第 1 周（11/16-11/22）为警告周：未完成只提醒不罚
    tailWeek: 14,                 // 第 14 周（2/15 起）进入收尾降档：自动降档，完成 1 次即达标
    tailPassOnce: true,           // 收尾周只需 1 次有效打卡即算完成
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

// 周次：以开营周一为第 1 周，按自然周对齐。
// 开营前为 0 或负数（试运行周）——保留真实偏移，这样每个周一都会自然 +1，
// KPI 按周解锁、打卡按周归组才不会把相邻两周混在一起。
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

// ===== 职务：成员主记录 + 兼任指派 =====
// winter_member 一人只有一条记录（主键就是 userId），天然只能属于一个组；
// 身兼数职靠 winter_staff 额外指派：{ userId, groupId, role }，一个人可同时担任多组的队长/教练。

// 某人在某组的职务（主记录优先，其次查兼任指派）
async function roleInGroup(userId, groupId) {
  if (!userId || !groupId) return '';
  const m = await getMyMember(userId);
  if (m && m.groupId === groupId && ['approved', 'quit-suggested'].includes(m.status)) return m.role;
  const r = await db.collection('winter_staff').where({ userId, groupId }).limit(1).get().catch(() => null);
  const d = r && r.data && r.data[0];
  return d ? d.role : '';
}

// 某人担任这些职务的所有组别（含其主组）
async function staffGroupIdsOf(userId, roles) {
  const out = [];
  if (!userId || !roles || !roles.length) return out;
  const m = await getMyMember(userId);
  if (m && m.groupId && roles.includes(m.role) && ['approved', 'quit-suggested'].includes(m.status)) {
    out.push(m.groupId);
  }
  const r = await db.collection('winter_staff')
    .where({ userId, role: _.in(roles) }).limit(50).get().catch(() => null);
  for (const d of ((r && r.data) || [])) {
    if (d.groupId && out.indexOf(d.groupId) < 0) out.push(d.groupId);
  }
  return out;
}

// 加入某组时按组别配置决定缴费状态
// 例如 S 组自带训练计划和习惯，属于特殊福利组：加入即标记「免费」，不计入收费统计。
// 只对开了 autoFree 的组生效；未开启的组保持原有缴费状态不动（不会把已缴费的人改回去）
async function applyGroupFreeFee(updateData, groupId) {
  if (!groupId) return updateData;
  const g = await db.collection('winter_group').doc(groupId).get().catch(() => null);
  if (g && g.data && g.data.autoFree) updateData.feeStatus = 'free';
  return updateData;
}

// 一组 userId → 昵称列表（优先用已查好的成员池，避免重复查库）
async function namesOf(ids, memberPool) {
  const arr = [];
  for (const uid of (ids || [])) {
    const inPool = (memberPool || []).find(m => m.userId === uid);
    if (inPool) { arr.push(inPool.nickName || '未知'); continue; }
    const u = await getUser(uid);
    const m = await getMyMember(uid);
    arr.push((u && (u.nickName || u.nickname)) || (m && m.nickName) || '未知');
  }
  return arr;
}

// 某组担任这些职务的所有人 userId（本组成员 + 兼任指派，去重）
async function groupStaffUserIds(groupId, roles) {
  const ids = [];
  if (!groupId || !roles || !roles.length) return ids;
  for (const m of await getMemberListOfGroup(groupId)) {
    if (m.userId && roles.includes(m.role) && ids.indexOf(m.userId) < 0) ids.push(m.userId);
  }
  const r = await db.collection('winter_staff')
    .where({ groupId, role: _.in(roles) }).limit(50).get().catch(() => null);
  for (const d of ((r && r.data) || [])) {
    if (d.userId && ids.indexOf(d.userId) < 0) ids.push(d.userId);
  }
  return ids;
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
  // 试运行期照常考核，仅春节周跳过考核
  const holidayNow2 = cfg.phase === 'holiday' || isHolidayWeek(cfg, weekIndex);
  const frozen = holidayNow2;
  const frozenReason = holidayNow2 ? 'holiday' : '';

  const result = {
    cfg: {
      phase: cfg.phase, signupOpen: cfg.signupOpen, title: cfg.title, subtitle: cfg.subtitle,
      intro: cfg.intro, startMonday: cfg.startMonday, totalWeeks: cfg.totalWeeks,
      fee: cfg.fee, rulesText: cfg.rulesText, holidayWeeks: cfg.holidayWeeks || [],
      scale: cfg.scale || { target: 100, max: 150 },
      fineTiers: cfg.fineTiers || [5, 10, 20], finePackets: cfg.finePackets || 5,
      warnWeek: Number(cfg.warnWeek) || 1, tailWeek: Number(cfg.tailWeek) || 0,
    },
    weekIndex, frozen, frozenReason,
    isAdmin,
    // 已退组的人不算「已加入」，首页要重新露出售前/报名入口
    joined: !!member && member.status !== 'quit',
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

  // 本周进度（首页直接展示跑量与 KPI 完成情况，不用再点进榜单）
  if (member.status === 'approved' || member.status === 'quit-suggested') {
    const wr = await db.collection('winter_checkin').where({ userId, weekIndex }).limit(100).get().catch(() => null);
    const all = (wr && wr.data) || [];
    const wl = all.filter(c => c.status === 'approved');
    const r1 = (v) => Math.round(toNum(v) * 10) / 10;
    const wDist = wl.reduce((s, c) => s + toNum(c.distance), 0);
    const wDur = wl.reduce((s, c) => s + toNum(c.duration), 0);
    const wDays = new Set(wl.map(c => c.date)).size;
    const wk = await getWeekKpi(member, weekIndex);
    const actual = wk.type === 'attendance' ? wDays : r1(wDist);
    const rate = wk.value > 0 ? Math.min(1, actual / wk.value) : 0;
    result.myWeek = {
      distance: r1(wDist),           // 本周跑量（公里）
      duration: Math.round(wDur),    // 本周总时长（分钟）
      days: wDays,                   // 本周有打卡的天数
      count: wl.length,              // 已通过条数
      pending: all.length - wl.length, // 待审核条数
      kpiType: wk.type || '', target: wk.value, actual,
      rate: Math.round(rate * 100),
      // 距目标还差多少（同样只保留一位小数）
      remain: wk.value > 0 ? Math.round((wk.value - actual) * 10) / 10 : 0,
      // 春节周不考核 → null；没填 KPI → null
      completed: frozen || wk.value <= 0 ? null : rate >= 1,
    };
  }

  // 在多个组兼任队长/教练时，角标统计所有任职组
  const staffGroups = await staffGroupIdsOf(userId, ['leader', 'coach']);
  if (staffGroups.length && member.status === 'approved') {
    let pendingCount = 0;
    for (const gid of staffGroups) {
      await autoApproveOverdue(gid);
      // 免审的队长/教练本人不计入待审
      const st = await groupStaffUserIds(gid, ['leader', 'coach']);
      const prAll = await db.collection('winter_checkin').where({
        groupId: gid, status: 'pending',
      }).count().catch(() => ({ total: 0 }));
      let staffPending = 0;
      if (st.length) {
        const prStaff = await db.collection('winter_checkin').where({
          groupId: gid, status: 'pending', userId: _.in(st),
        }).count().catch(() => ({ total: 0 }));
        staffPending = prStaff.total || 0;
      }
      pendingCount += Math.max(0, (prAll.total || 0) - staffPending);
    }
    result.pendingCount = pendingCount;
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
  // 兼任指派：同一人可以在多个组担任队长/教练
  const extraRes = await db.collection('winter_staff').limit(200).get().catch(() => null);
  for (const d of ((extraRes && extraRes.data) || [])) {
    if (!staffMap[d.groupId]) staffMap[d.groupId] = { leader: [], coach: [] };
    const u = await getUser(d.userId);
    const mm = await getMyMember(d.userId);
    const name = (u && (u.nickName || u.nickname)) || (mm && mm.nickName) || '待任命';
    const arr = staffMap[d.groupId][d.role === 'leader' ? 'leader' : 'coach'];
    if (arr.indexOf(name) < 0) arr.push(name);
  }
  return ok({
    cfg: {
      phase: cfg.phase, signupOpen: cfg.signupOpen, title: cfg.title, subtitle: cfg.subtitle,
      intro: cfg.intro, fee: cfg.fee, rulesText: cfg.rulesText, totalWeeks: cfg.totalWeeks,
      holidayWeeks: cfg.holidayWeeks || [], scale: cfg.scale || { target: 100, max: 150 },
      fineTiers: cfg.fineTiers || [5, 10, 20], finePackets: cfg.finePackets || 5,
      warnWeek: Number(cfg.warnWeek) || 1, tailWeek: Number(cfg.tailWeek) || 0,
      startMonday: cfg.startMonday,
    },
    groups: groups.map(g => ({
      _id: g._id, name: g.name, desc: g.desc || '', emblem: g.emblem || '',
      capacity: g.capacity || 0, open: g.open !== false,
      slogan: g.slogan || '', sloganImage: g.sloganImage || '',
      targetSize: g.targetSize || '', suggest: g.suggest || null,
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

  // 已退组或被驳回的人可以重新报名（改组 / 回归），其余状态不可重复提交
  const exist = await getMyMember(userId);
  const RENEW_STATUS = ['quit', 'rejected'];
  if (exist && !RENEW_STATUS.includes(exist.status)) return fail('你已报名，不可重复提交');

  // 总规模上限：目标 100 人，上限 150 人，招满即止
  const scaleMax = Number((cfg.scale && cfg.scale.max) || 0);
  if (scaleMax > 0) {
    const tc = await db.collection('winter_member')
      .where({ status: _.in(['approved', 'pending']) }).count().catch(() => ({ total: 0 }));
    if ((tc.total || 0) >= scaleMax) return fail(`报名已满 ${scaleMax} 人，招满即止`);
  }

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

  // 审批规则（2026-10 调整）：
  // · 队长：由管理组（超管）审批任命
  // · 教练 / 队员：由本组队长审批
  // · 没有队长的组也开放加入，此时由管理组审批，避免申请无人处理
  // 缴费不作为通过的前置条件：由队长线下收款后自行维护状态
  // 一律不自动通过，全部走 pending
  let applyReviewer = 'leader';
  let groupHasLeader = true;
  if (role === 'leader') {
    applyReviewer = 'admin';
  } else {
    const leaderCnt = await db.collection('winter_member')
      .where({ groupId, role: 'leader', status: 'approved' }).count().catch(() => ({ total: 0 }));
    if (!(leaderCnt.total > 0)) {
      groupHasLeader = false;
      applyReviewer = 'admin'; // 无队长则由管理组代审
    }
  }

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
    status: 'pending',
    applyReviewer,                 // leader = 本组队长审；admin = 管理组审
    kpiType: '',
    kpiValue: 0,
    kpiWeek: 0,
    continuousFailWeeks: 0,
    feeStatus: 'unpaid',
    createTime: new Date(),
    updateTime: new Date(),
  };
  if (exist) {
    // 重新报名：沿用同一条成员记录，KPI/缴费等重新走一遍
    const patch = Object.assign({}, record, { updateTime: new Date() });
    delete patch._id;
    delete patch.createTime;
    await db.collection('winter_member').doc(userId).update({ data: patch });
    await saveLog({
      type: 'apply', action: 'resubmit', operatorId: userId, targetUserId: userId,
      detail: `重新报名 ${ROLE_TEXT[role]} → ${g.data.name}（原状态 ${exist.status}）`,
    });
    return ok({ status: 'pending', needReview: true, reviewer: applyReviewer, noLeader: !groupHasLeader, reapplied: true });
  }
  await db.collection('winter_member').add({ data: record });
  await saveLog({
    type: 'apply', action: 'submit', operatorId: userId, targetUserId: userId,
    detail: `${ROLE_TEXT[role]} → ${g.data.name}，待${applyReviewer === 'admin' ? '管理组' : '队长'}审批`,
  });
  return ok({ status: 'pending', needReview: true, reviewer: applyReviewer, noLeader: !groupHasLeader });
}

// 主动退组：退出后可重新报名加入其他组
async function actionQuitGroup(userId, data) {
  const member = await getMyMember(userId);
  if (!member) return fail('尚未报名');
  if (member.status === 'quit') return fail('你已退组，可直接重新报名');
  if (member.role === 'leader') {
    return fail('队长需先在成员页把队长职务移交他人，再联系管理组退组');
  }
  if (!['approved', 'pending', 'rejected', 'quit-suggested'].includes(member.status)) {
    return fail('当前状态不可退组');
  }
  // 清掉本组 KPI：换组后区间不同，需要按新组重新填报
  await db.collection('winter_member').doc(userId).update({
    data: {
      status: 'quit',
      kpiType: '', kpiValue: 0, kpiWeek: 0, kpiSubmitTime: null,
      quitTime: new Date(), updateTime: new Date(),
    },
  });
  await saveLog({
    type: 'quit', action: 'self', operatorId: userId, targetUserId: userId,
    detail: `${ROLE_TEXT[member.role]} 主动退组`,
  });
  return ok({ status: 'quit' });
}

// 我的组（名单 + 区间 + 我的 KPI）
async function actionGetMyGroup(userId) {
  const member = await getMyMember(userId);
  if (!member) return fail('尚未报名');
  const g = await db.collection('winter_group').doc(member.groupId).get().catch(() => null);
  const group = g && g.data ? {
    _id: g.data._id, name: g.data.name, desc: g.data.desc || '', emblem: g.data.emblem || '',
    capacity: g.data.capacity || 0, targetSize: g.data.targetSize || '',
    slogan: g.data.slogan || '', sloganImage: g.data.sloganImage || '',
    suggest: g.data.suggest || null,
  } : null;
  const raw = await getMemberListOfGroup(member.groupId);
  // 兼任本组队长/教练的人，成员主记录在他自己的组里，这里补进名单一起展示
  const extraIds = await groupStaffUserIds(member.groupId, ['leader', 'coach']);
  const inGroup = new Set(raw.map(m => m.userId));
  const extraRaw = [];
  for (const uid of extraIds) {
    if (inGroup.has(uid)) continue;
    const m = await getMyMember(uid);
    if (!m || !['approved', 'quit-suggested'].includes(m.status)) continue;
    extraRaw.push(Object.assign({}, m, { role: (await roleInGroup(uid, member.groupId)) || m.role }));
  }
  const members = await decorateMembers(raw.concat(extraRaw));
  // 本人可能是在本组兼任队长/教练，权限按本组职务算
  const myRoleHere = (await roleInGroup(userId, member.groupId)) || member.role;
  const kpiRange = await getKpiRange(member.groupId);
  const cfg = await getConfig();
  const weekIndex = calcWeekIndex(cfg);
  // 试运行期照常考核，只有春节周跳过考核
  const holidayNow = cfg.phase === 'holiday' || isHolidayWeek(cfg, weekIndex);

  // 本周还能不能改 KPI：本周已打过卡就不许改（周 KPI，每周一解锁）
  let kpiCanChange = true;
  if (member.kpiWeek === weekIndex) {
    const ckc = await db.collection('winter_checkin')
      .where({ userId, weekIndex }).limit(1).count().catch(() => ({ total: 0 }));
    kpiCanChange = !(ckc.total > 0);
  }
  // 最近 8 周的 KPI 记录，供本人追溯
  const kr = await db.collection('winter_kpi').where({ userId })
    .orderBy('weekIndex', 'desc').limit(8).get().catch(() => null);
  const kpiHistory = ((kr && kr.data) || []).map(x => ({
    weekIndex: x.weekIndex, type: x.type, value: toNum(x.value), auto: !!x.auto,
  }));

  return ok({
    group,
    members: members.sort((a, b) => {
      const ord = { leader: 0, coach: 1, member: 2 };
      return (ord[a.role] || 9) - (ord[b.role] || 9);
    }),
    kpiRange,
    me: {
      role: myRoleHere, roleText: ROLE_TEXT[myRoleHere] || '',
      // 超管在队伍页也开放编辑素材的入口（后台入口太深，超管本身就有改组信息的权限）
      isAdmin: await isSuperAdmin(userId),
      kpiType: member.kpiType || '', kpiValue: member.kpiValue || 0,
      kpiWeek: member.kpiWeek || 0,
      continuousFailWeeks: member.continuousFailWeeks || 0,
      status: member.status, remark: member.remark || '',
      feeStatus: member.feeStatus || 'unpaid',
      // 本周期已打过卡 → 锁定；新的一周自动解锁
      kpiLocked: !kpiCanChange && member.kpiWeek === weekIndex,
      kpiCanChange,
    },
    kpiHistory,
    weekIndex,
    phase: cfg.phase,
    frozen: holidayNow,
    frozenReason: holidayNow ? 'holiday' : '',
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

// ===== 周 KPI：每周一解锁重填，考核按当周目标，历史留痕可追溯 =====
// 取某人「某周」的 KPI 目标；没有周记录时退回成员上的当前值（兼容改版前的老数据）
async function getWeekKpi(m, weekIndex) {
  const r = await db.collection('winter_kpi').where({ userId: m.userId, weekIndex }).limit(1).get().catch(() => null);
  const d = r && r.data && r.data[0];
  if (d) return { type: d.type || '', value: toNum(d.value), auto: !!d.auto };
  // 老数据兜底：成员上存着 KPI 但没有周记录
  if (m.kpiWeek === weekIndex || (!m.kpiWeek && toNum(m.kpiValue) > 0)) {
    return { type: m.kpiType || '', value: toNum(m.kpiValue), auto: false };
  }
  return { type: '', value: 0, auto: false };
}

// 写入/覆盖某人某周的 KPI，并同步到成员上的「当前生效值」
async function saveWeekKpi(m, weekIndex, type, value, auto) {
  const payload = {
    userId: m.userId, groupId: m.groupId, weekIndex,
    type, value, auto: !!auto, updateTime: new Date(),
  };
  const exist = await db.collection('winter_kpi')
    .where({ userId: m.userId, weekIndex }).limit(1).get().catch(() => null);
  if (exist && exist.data && exist.data.length) {
    await db.collection('winter_kpi').doc(exist.data[0]._id).update({ data: payload }).catch(() => {});
  } else {
    await db.collection('winter_kpi').add({ data: Object.assign({ createTime: new Date() }, payload) }).catch(() => {});
  }
  await db.collection('winter_member').doc(m.userId).update({
    data: {
      kpiType: type, kpiValue: value, kpiWeek: weekIndex,
      kpiSubmitTime: new Date(), updateTime: new Date(),
    },
  }).catch(() => {});
}

// 本周还没目标时自动继承上一周（最多回溯 4 周），保证用户不用每周必点一次
async function ensureWeekKpi(m, cfg, rangeOpt) {
  const weekIndex = calcWeekIndex(cfg);
  if (m.kpiWeek === weekIndex && toNum(m.kpiValue) > 0) {
    return { weekIndex, type: m.kpiType, value: toNum(m.kpiValue), inherited: false };
  }
  for (let w = weekIndex - 1; w >= 0 && w >= weekIndex - 4; w--) {
    // 只继承「同一个组」的目标：换组后旧组的目标不能带到新组
    const r = await db.collection('winter_kpi')
      .where({ userId: m.userId, weekIndex: w, groupId: m.groupId }).limit(1).get().catch(() => null);
    const d = r && r.data && r.data[0];
    if (d && toNum(d.value) > 0) {
      const a = await alignToRange(m.groupId, d.type, toNum(d.value), rangeOpt);
      await saveWeekKpi(m, weekIndex, a.type, a.value, true);
      return { weekIndex, type: a.type, value: a.value, inherited: true };
    }
  }
  // 改版前的老数据：成员上有值但没有周记录，按当前区间对齐后补一条
  if (toNum(m.kpiValue) > 0) {
    const a = await alignToRange(m.groupId, m.kpiType, toNum(m.kpiValue), rangeOpt);
    await saveWeekKpi(m, weekIndex, a.type, a.value, true);
    return { weekIndex, type: a.type, value: a.value, inherited: true };
  }
  return null;
}

// 继承来的目标可能落在教练新设的区间之外（甚至类型都换了），对齐后再继承
// 只收上限、不抬下限：超上限会永远完不成，低于下限只是更宽松，不能擅自加重负担
async function alignToRange(groupId, type, value, rangeOpt) {
  const range = rangeOpt || await getKpiRange(groupId);
  if (!range) return { type, value };
  // 区间类型变了（跑量↔出勤），旧数值没有可比性，按下限起步
  if (type !== range.type) return { type: range.type, value: toNum(range.min) };
  let v = value;
  if (v > toNum(range.max)) v = toNum(range.max);
  return { type, value: v };
}

// 队员：区间内填报本周 KPI（自动通过，越界拒绝）
async function actionSubmitKpi(userId, data) {
  const member = await getMyMember(userId);
  if (!member) return fail('尚未报名');
  if (member.status !== 'approved') return fail('报名未通过，不可填报');
  const range = await getKpiRange(member.groupId);
  if (!range) return fail('教练尚未设定 KPI 区间');
  const cfg = await getConfig();
  const weekIndex = calcWeekIndex(cfg);
  const type = String(data.kpiType || range.type);
  if (type !== range.type) return fail(`本组 KPI 类型为${range.type === 'distance' ? '跑量' : '出勤'}，不可更改`);
  // 本周已经打过卡就不允许再改目标（否则可以打完卡再把目标改低）
  if (member.kpiWeek === weekIndex) {
    const ckc = await db.collection('winter_checkin')
      .where({ userId, weekIndex }).limit(1).count().catch(() => ({ total: 0 }));
    if ((ckc.total || 0) > 0) {
      return fail('本周已有打卡记录，KPI 不可再改；下周一可重新填报');
    }
  }
  const value = toNum(data.kpiValue);
  if (value < range.min || value > range.max) {
    return fail(`KPI 需在 ${range.min} ~ ${range.max} 之间`);
  }
  await saveWeekKpi(member, weekIndex, type, value, false);
  return ok({ kpiType: type, kpiValue: value, weekIndex, locked: true });
}

// 每日打卡
async function actionDoCheckin(userId, data) {
  const cfg = await getConfig();
  if (cfg.phase === 'closed') return fail('冬训营未开放');
  const member = await getMyMember(userId);
  if (!member) return fail('尚未报名');
  if (member.status !== 'approved' && member.status !== 'quit-suggested') return fail('报名未通过');
  const range = await getKpiRange(member.groupId);
  // 本组是否开启打卡免审核（例如 S 组，后台组别里可配）
  const grpDoc = member.groupId
    ? await db.collection('winter_group').doc(member.groupId).get().catch(() => null)
    : null;
  const groupAutoApprove = !!(grpDoc && grpDoc.data && grpDoc.data.autoApprove);
  // 周 KPI：本周还没目标的自动继承上周目标，没有历史才要求先填
  const weekKpi = await ensureWeekKpi(member, cfg, range);
  if (!weekKpi) return fail('请先填报本周 KPI');

  const date = data.date || todayStr();
  const today = todayStr();
  // 补卡规则：本周（周一 00:00 ~ 周日 23:59:59）内的日期均可提交；
  // 周一零点起本周锁定，上周打卡不可再补（不设跨周补卡入口）
  const weekStart = mondayOf(today);
  // 注意 diffDays(a,b) = a-b：前者在后才是正数
  if (diffDays(date, today) > 0) return fail('不能给未来的日期打卡');
  if (diffDays(date, weekStart) < 0) {
    return fail('打卡已于周日 24 点截止，周一零点起不可再补上周的卡');
  }

  const imageFileID = String((data.imageFileID || data.image || '')).trim();
  const distance = toNum(data.distance);
  const duration = toNum(data.duration);
  const note = String(data.note || '').trim();
  if (!imageFileID) return fail('请上传一张跑步记录截图');
  if (weekKpi.type === 'distance' && distance <= 0) return fail('请填写本次跑量（公里）');
  if (weekKpi.type === 'attendance' && duration <= 0) return fail('请填写本次时长（分钟）');

  // 单次最低时长校验（区间已在前面取好，复用）
  if (range && range.minDuration && duration > 0 && duration < range.minDuration) {
    return fail(`单次训练时长不得低于 ${range.minDuration} 分钟`);
  }

  const exist = await db.collection('winter_checkin').where({ userId, date }).limit(1).get().catch(() => null);
  const weekIndexRaw = Math.floor(diffDays(mondayOf(date), cfg.startMonday) / 7) + 1;
  // 开营前（11/1—11/15 试运行）允许打卡练手；此时 weekIndex 为 0 或负数，
  // 与 calcWeekIndex 保持同一口径，周一自动换周，不会和上周混在一起。
  if (weekIndexRaw < 1 && cfg.phase !== 'trial') return fail('不在冬训周期内');
  const weekIndex = weekIndexRaw;

  const payload = {
    userId, groupId: member.groupId, date, weekIndex,
    monday: mondayOf(date),
    imageFileID, distance, duration, note,
    kpiType: weekKpi.type,
    updateTime: new Date(),
  };
  // 队长 / 教练的打卡无需他人审核，直接通过（他们只负责审队员）
  // 另外：后台给某个组开了「打卡免审核」时（如 S 组），全组成员都自动通过
  const selfPass = member.role === 'leader' || member.role === 'coach';
  if (selfPass || groupAutoApprove) {
    payload.status = 'approved';
    payload.reviewerId = 'system';
    payload.reviewNote = selfPass ? '队长/教练打卡自动通过' : '本组打卡免审核，自动通过';
    payload.reviewTime = new Date();
    payload.autoApproved = true;
  }
  if (exist && exist.data && exist.data.length) {
    if (exist.data[0].status === 'approved' && !selfPass) return fail('该日期打卡已通过审核，不可修改');
    if (!selfPass) {
      payload.status = 'pending';
      payload.reviewerId = '';
      payload.reviewNote = '';
    }
    await db.collection('winter_checkin').doc(exist.data[0]._id).update({ data: payload });
    return ok({ id: exist.data[0]._id, updated: true, status: payload.status });
  }
  if (!selfPass) payload.status = 'pending';
  payload.createTime = new Date();
  const addRes = await db.collection('winter_checkin').add({ data: payload });
  return ok({ id: addRes._id, status: payload.status });
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

// 组内打卡记录：本组成员互相可见（不仅是自己的）
async function actionGroupCheckins(userId, data) {
  const member = await getMyMember(userId);
  if (!member) return fail('尚未报名');
  if (member.status !== 'approved' && member.status !== 'quit-suggested') return fail('报名未通过');
  const cfg = await getConfig();
  const weekIndex = data.weekIndex !== undefined ? Number(data.weekIndex) : calcWeekIndex(cfg);
  const where = { groupId: member.groupId };
  if (weekIndex > 0) where.weekIndex = weekIndex;
  const r = await db.collection('winter_checkin').where(where)
    .orderBy('date', 'desc').limit(200).get().catch(() => null);
  const list = (r && r.data) || [];
  const out = [];
  for (const c of list) {
    const u = await getUser(c.userId);
    out.push({
      ...c,
      nickName: (u && (u.nickName || u.nickname)) || '未知',
      avatarUrl: (u && u.avatarUrl) || '',
      isMe: c.userId === userId,
    });
  }
  return ok({ weekIndex, list: out, myRole: member.role });
}

// 队长：查看本组待审的入队申请（队员/教练）
async function actionLeaderApplies(userId) {
  const member = await getMyMember(userId);
  if (!member) return fail('尚未报名');
  if (member.status !== 'approved') return fail('你尚未通过任命');
  // 同时在多个组担任队长时（兼任指派），把所有任职组的申请一并拉出来
  const gids = await staffGroupIdsOf(userId, ['leader']);
  if (!gids.length) return fail('仅队长可审核入队申请');
  const gRes = await db.collection('winter_group').limit(50).get().catch(() => null);
  const gName = {};
  for (const g of ((gRes && gRes.data) || [])) gName[g._id] = g.name;
  const r = await db.collection('winter_member')
    .where({ groupId: _.in(gids), status: 'pending', role: _.in(['member', 'coach']) })
    .limit(100).get().catch(() => null);
  const list = ((r && r.data) || []).map(m => ({
    _id: m._id, userId: m.userId, nickName: m.nickName,
    groupId: m.groupId, groupName: gName[m.groupId] || '',
    role: m.role, roleText: ROLE_TEXT[m.role] || '',
    recentResult: m.recentResult || '', target: m.target || '',
    reason: m.reason || '', feeStatus: m.feeStatus || 'unpaid',
    createTime: m.createTime || null,
  }));
  return ok({ list });
}

// 队长：审批入队申请（规则：确认线下缴费后才可通过）
async function actionLeaderReviewApply(userId, data) {
  const me = await getMyMember(userId);
  if (!me) return fail('尚未报名');
  if (me.status !== 'approved') return fail('你尚未通过任命');
  const myGroups = await staffGroupIdsOf(userId, ['leader']);
  if (!myGroups.length) return fail('仅队长可审批');
  const targetId = String(data.userId || data.id || '');
  const pass = data.pass === true || String(data.pass) === 'true';
  if (!targetId) return fail('缺少成员');
  const t = await db.collection('winter_member').doc(targetId).get().catch(() => null);
  if (!t || !t.data) return fail('报名记录不存在');
  const m = t.data;
  if (myGroups.indexOf(m.groupId) < 0) return fail('只能审批你担任队长的组');
  if (m.status !== 'pending') return fail('该申请已处理');

  if (!pass) {
    await db.collection('winter_member').doc(targetId).update({
      data: { status: 'rejected', rejectReason: String(data.note || ''), updateTime: new Date() },
    });
    await saveLog({ type: 'apply', action: 'leader-reject', operatorId: userId, targetUserId: targetId, detail: String(data.note || '') });
    return ok({ status: 'rejected' });
  }
  // 缴费不作为通过条件：是否缴费由队长线下收款后自行维护状态
  // 容量复核
  const g = await db.collection('winter_group').doc(m.groupId).get().catch(() => null);
  if (g && g.data && g.data.capacity) {
    const cnt = await db.collection('winter_member').where({ groupId: m.groupId, status: 'approved' }).count().catch(() => ({ total: 0 }));
    if ((cnt.total || 0) >= g.data.capacity) return fail('本组人数已满');
  }
  // 教练唯一性
  if (m.role === 'coach') {
    const dup = await db.collection('winter_member').where({ groupId: m.groupId, role: 'coach', status: 'approved' }).count().catch(() => ({ total: 0 }));
    if ((dup.total || 0) > 0) return fail('本组已有教练');
  }
  // 加入即免费：目标组开了 autoFree（如 S 组）时直接标记
  const approveData = await applyGroupFreeFee(
    { status: 'approved', rejectReason: '', approveTime: new Date(), updateTime: new Date() }, m.groupId);
  await db.collection('winter_member').doc(targetId).update({ data: approveData });
  await saveLog({ type: 'apply', action: 'leader-approve', operatorId: userId, targetUserId: targetId, detail: ROLE_TEXT[m.role] });
  return ok({ status: 'approved' });
}

// 缴费状态切换（队长可改本组，管理组可改全部）
async function actionSetFeeStatus(userId, data) {
  const me = await getMyMember(userId);
  const isAdmin = await isSuperAdmin(userId);
  if (!me && !isAdmin) return fail('无权操作');
  const targetId = String(data.userId || '');
  // 三态：paid 已缴费 / unpaid 未缴费 / free 免费（无需交费）
  const asked = String(data.feeStatus || '');
  const feeStatus = FEE_STATUS_SET.includes(asked) ? asked : 'unpaid';
  if (!targetId) return fail('缺少成员');
  const t = await db.collection('winter_member').doc(targetId).get().catch(() => null);
  if (!t || !t.data) return fail('成员不存在');
  if (!isAdmin) {
    if (!me || me.status !== 'approved') return fail('仅队长可修改缴费状态');
    const myGroups = await staffGroupIdsOf(userId, ['leader']);
    if (!myGroups.length) return fail('仅队长可修改缴费状态');
    if (myGroups.indexOf(t.data.groupId) < 0) return fail('只能修改你担任队长的组');
  }
  await db.collection('winter_member').doc(targetId).update({
    data: { feeStatus, feeTime: feeStatus === 'paid' ? new Date() : null, updateTime: new Date() },
  });
  await saveLog({ type: 'fee', action: feeStatus, operatorId: userId, targetUserId: targetId });
  return ok({ feeStatus });
}

// 队长/教练：编辑本组的宣言与照片
// 管理后台只有超管能进，队长平时进不去；队伍氛围相关的东西还是交给队长自己维护
async function actionLeaderSaveGroup(userId, data) {
  const me = await getMyMember(userId);
  const boss = await isSuperAdmin(userId);
  // 超管例外：后台本来就能改组别信息，只是入口深，这里给个快捷通道
  if (!boss) {
    if (!me) return fail('尚未报名');
    if (!['leader', 'coach'].includes(me.role)) return fail('仅队长/教练可编辑队伍信息');
    if (me.status !== 'approved') return fail('报名未通过');
  }
  if (!me || !me.groupId) return fail('尚未分组');
  const update = {};
  if (data.slogan !== undefined) update.slogan = String(data.slogan || '').trim().slice(0, 20);
  if (data.sloganImage !== undefined) update.sloganImage = String(data.sloganImage || '').trim();
  if (!Object.keys(update).length) return fail('没有要保存的内容');
  update.updateTime = new Date();
  await db.collection('winter_group').doc(me.groupId).update({ data: update });
  await saveLog({ type: 'group', action: 'leader-save', operatorId: userId, groupId: me.groupId, detail: update.slogan || '' });
  return ok(update);
}

// 角色转让：队长/教练把角色交给本组队员，无需审批
async function actionTransferRole(userId, data) {
  const me = await getMyMember(userId);
  if (!me) return fail('尚未报名');
  if (!['leader', 'coach'].includes(me.role)) return fail('仅队长/教练可转让角色');
  if (me.status !== 'approved') return fail('你的状态异常，无法转让');
  const targetId = String(data.userId || '');
  if (!targetId) return fail('请选择接任的队员');
  if (targetId === userId) return fail('不能转让给自己');
  const t = await db.collection('winter_member').doc(targetId).get().catch(() => null);
  if (!t || !t.data) return fail('成员不存在');
  const m = t.data;
  if (m.groupId !== me.groupId) return fail('只能转让给本组成员');
  if (m.status !== 'approved') return fail('该队员尚未通过审核');
  if (m.role !== 'member') return fail('只能转让给队员');
  const role = me.role;
  await db.collection('winter_member').doc(targetId).update({ data: { role, updateTime: new Date() } });
  await db.collection('winter_member').doc(userId).update({ data: { role: 'member', updateTime: new Date() } });
  await saveLog({ type: 'role', action: 'transfer', operatorId: userId, targetUserId: targetId, detail: `${ROLE_TEXT[role]} 转让` });
  return ok({ role, newRole: 'member' });
}

// 待审核列表（仅队长/教练可见本组，排除自己）
// 注：队长/教练本人打卡免审，不进待审列表；历史遗留的 pending 记录在这里补正为自动通过
async function actionPendingReview(userId, data) {
  const member = await getMyMember(userId);
  if (!member) return fail('尚未报名');
  if (member.status !== 'approved') return fail('尚未通过任命');
  // 在多个组兼任队长/教练时，所有任职组的待审打卡都要能看到
  const gids = await staffGroupIdsOf(userId, ['leader', 'coach']);
  if (!gids.length) return fail('仅队长/教练可审核');
  for (const gid of gids) await autoApproveOverdue(gid);

  // 这些组的队长/教练（他们的打卡不需要任何人审核）
  const staffIds = [];
  for (const gid of gids) {
    for (const id of await groupStaffUserIds(gid, ['leader', 'coach'])) {
      if (staffIds.indexOf(id) < 0) staffIds.push(id);
    }
  }

  // 历史数据补正：免审改版前提交的队长/教练打卡仍是 pending，直接置为自动通过
  if (staffIds.length) {
    const fixRes = await db.collection('winter_checkin').where({
      groupId: _.in(gids), status: 'pending', userId: _.in(staffIds),
    }).limit(200).get().catch(() => null);
    for (const c of ((fixRes && fixRes.data) || [])) {
      await db.collection('winter_checkin').doc(c._id).update({
        data: {
          status: 'approved', reviewerId: 'system',
          reviewNote: '队长/教练打卡免审，自动通过', reviewTime: new Date(), autoApproved: true,
        },
      }).catch(() => {});
    }
  }

  const staffSet = new Set(staffIds);
  const r = await db.collection('winter_checkin').where({
    groupId: _.in(gids), status: 'pending',
  }).orderBy('date', 'desc').limit(100).get().catch(() => null);
  // 只留队员的打卡：排除自己与这些组的队长/教练
  const list = ((r && r.data) || []).filter(c => c.userId !== userId && !staffSet.has(c.userId));
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
  // 权限按「本组职务」算：支持在多个组兼任队长/教练
  const myGroups = await staffGroupIdsOf(userId, ['leader', 'coach']);
  if (!myGroups.length && !isAdmin) return fail('无审核权限');
  const id = String(data.id || '');
  const pass = data.pass === true || String(data.pass) === 'true';
  const note = String(data.note || '').trim();
  if (!id) return fail('缺少打卡记录');
  if (!pass && !note) return fail('驳回需填写原因');
  const cRes = await db.collection('winter_checkin').doc(id).get().catch(() => null);
  if (!cRes || !cRes.data) return fail('打卡记录不存在');
  const c = cRes.data;
  if (c.userId === userId) return fail('不能审核自己的打卡');
  if (!isAdmin && myGroups.indexOf(c.groupId) < 0) return fail('只能审核你任职的组的打卡');
  // 互审：队长只能审队员+教练，教练只能审队员+队长；管理组不受限
  if (!isAdmin) {
    const myRoleHere = await roleInGroup(userId, c.groupId);
    if (['leader', 'coach'].includes(myRoleHere)) {
      const target = await getMyMember(c.userId);
      const targetRole = await roleInGroup(c.userId, c.groupId);
      if ((targetRole || (target && target.role)) === myRoleHere) return fail('队长/教练需互审，不可审同角色');
    }
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
  // 跑量保留一位小数（打卡距离可能带多位小数，累加后噪声更大）
  const r1 = (v) => Math.round(toNum(v) * 10) / 10;
  // 试运行周、春节周均「跳过考核」：打卡照常记录，但不计完成率、不计完成人数、不排名
  // 试运行期照常考核，仅春节周跳过考核
  const holidayNow = cfg.phase === 'holiday' || isHolidayWeek(cfg, weekIndex);
  const frozen = holidayNow;
  const frozenReason = holidayNow ? 'holiday' : '';

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
    // 周 KPI：按「当周」目标考核，而不是成员上的当前值
    const wk = await getWeekKpi(m, weekIndex);
    const target = wk.value;
    let actual = 0, rate = 0;
    if (target > 0) {
      actual = wk.type === 'attendance' ? days : totalDistance;
      rate = Math.min(1, actual / target);
    }
    // frozen 周完成状态为 null（不考核），避免虚增完成人数
    const completed = frozen ? null : (target > 0 && rate >= 1);
    if (completed) completedCnt++;
    sumRate += rate;
    const u = await getUser(m.userId);
    stats.push({
      userId: m.userId,
      nickName: (u && (u.nickName || u.nickname)) || m.nickName || '未知',
      avatarUrl: (u && u.avatarUrl) || '',
      role: m.role, roleText: ROLE_TEXT[m.role] || '',
      // 个人榜展示保留一位小数，避免 12.3456789 这种浮点噪声
      kpiType: wk.type, target, actual: r1(actual), days,
      totalDistance: r1(totalDistance), totalDuration: Math.round(totalDuration),
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
      const wkr = await getWeekKpi(m, weekIndex);
      const target = wkr.value;
      let rate = 0;
      if (target > 0) rate = Math.min(1, (wkr.type === 'attendance' ? days : totalDistance) / target);
      sum += rate;
      if (!frozen && rate >= 1) done++; // 春节/试运行周不考核，不计入完成人数
    }
    teamRank.push({
      groupId: g._id, name: g.name, emblem: g.emblem || '',
      avgRate: Math.round((sum / ms.length) * 100),
      memberCount: ms.length, completedCount: done,
    });
  }
  teamRank.sort((a, b) => b.avgRate - a.avgRate);

  return ok({
    weekIndex, frozen, frozenReason,
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
  // 每档上限 800 字（与前端 maxlength 一致，防止绕过前端提交超长内容）
  const MAX_LEN = 800;
  const payload = {
    groupId: member.groupId, weekIndex,
    a: String((tiers[0] || {}).content || data.a || '').slice(0, MAX_LEN),
    b: String((tiers[1] || {}).content || data.b || '').slice(0, MAX_LEN),
    c: String((tiers[2] || {}).content || data.c || '').slice(0, MAX_LEN),
    advice: String(data.advice || '').slice(0, MAX_LEN),
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
  // 周 KPI 历史（每周填报的目标，可追溯）
  const kpis = await db.collection('winter_kpi').where({ userId }).orderBy('weekIndex', 'desc').limit(20).get().catch(() => null);
  return ok({
    me: {
      nickName: member.nickName, role: member.role, roleText: ROLE_TEXT[member.role] || '',
      groupId: member.groupId, kpiType: member.kpiType, kpiValue: member.kpiValue,
      kpiWeek: member.kpiWeek || 0,
      continuousFailWeeks: member.continuousFailWeeks || 0,
      status: member.status, statusText: APPLY_STATUS_TEXT[member.status] || member.status,
      remark: member.remark || '', feeStatus: member.feeStatus || 'unpaid',
    },
    fee: cfg.fee,
    totalFee: toNum(cfg.fee.entry) + toNum(cfg.fee.coach) + toNum(cfg.fee.pool),
    weekIndex,
    fines: ((fines && fines.data) || []).map(f => ({ ...f, statusText: FINE_TEXT[f.status] || f.status })),
    weekly: (weeklies && weeklies.data) || [],
    kpiHistory: ((kpis && kpis.data) || []).map(x => ({
      weekIndex: x.weekIndex, type: x.type, value: toNum(x.value), auto: !!x.auto,
    })),
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
    // 含兼任指派的人（成员主记录可能在别的组）
    const leaderIds = await groupStaffUserIds(g._id, ['leader']);
    const coachIds = await groupStaffUserIds(g._id, ['coach']);
    const leaderNames = await namesOf(leaderIds, members);
    const coachNames = await namesOf(coachIds, members);
    const range = await getKpiRange(g._id);
    groups.push({
      _id: g._id, name: g.name, desc: g.desc || '', emblem: g.emblem || '',
      capacity: g.capacity || 0, open: g.open !== false, sort: g.sort || 0,
      slogan: g.slogan || '', sloganImage: g.sloganImage || '',
      memberCount: gm.length,
      leader: leaderNames.length ? leaderNames.join('、') : '待任命',
      coach: coachNames.length ? coachNames.join('、') : '待任命',
      ready: leaderIds.length > 0 && coachIds.length > 0,
      kpiRange: range ? `${range.type === 'distance' ? '跑量' : '出勤'} ${range.min}~${range.max}` : '未设定',
    });
  }
  // 本周打卡待审总数（队长/教练本人免审，不计入）
  const staffIds = approved.filter(m => m.role === 'leader' || m.role === 'coach').map(m => m.userId).filter(Boolean);
  const pcAll = await db.collection('winter_checkin').where({ status: 'pending' }).count().catch(() => ({ total: 0 }));
  let pcStaff = 0;
  if (staffIds.length) {
    const r2 = await db.collection('winter_checkin').where({ status: 'pending', userId: _.in(staffIds) }).count().catch(() => ({ total: 0 }));
    pcStaff = r2.total || 0;
  }
  const pc = { total: Math.max(0, (pcAll.total || 0) - pcStaff) };
  return ok({
    cfg: {
      phase: cfg.phase, signupOpen: cfg.signupOpen, startMonday: cfg.startMonday,
      totalWeeks: cfg.totalWeeks, holidayWeeks: cfg.holidayWeeks || [], fee: cfg.fee,
      fineTiers: cfg.fineTiers || [5, 10, 20], finePackets: cfg.finePackets || 5,
      warnWeek: Number(cfg.warnWeek) || 1, tailWeek: Number(cfg.tailWeek) || 0,
      scale: cfg.scale || { target: 100, max: 150 },
      intro: cfg.intro, rulesText: cfg.rulesText,
    },
    weekIndex,
    counts: {
      total: members.length,
      // 管理后台处理：队长任命 + 无队长组的入队申请；其余由本组队长在「待审」里审
      pending: pending.filter(m => m.role === 'leader' || m.applyReviewer === 'admin').length,
      approved: approved.length,
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
    // 队伍宣言：20 字以内 + 一张配图（分享邀请卡使用）
    slogan: String(data.slogan || '').trim().slice(0, 20),
    sloganImage: String(data.sloganImage || '').trim(),
    // 打卡免审核：开启后本组成员打卡无需审批，直接通过（如 S 组）
    autoApprove: data.autoApprove === true,
    // 加入即免费：开启后新成员加入本组自动标记「免费」（如 S 组自带训练计划，属特殊福利组）
    autoFree: data.autoFree === true,
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

// 后台：某组的队长/教练名单 + 可指派候选人
// 候选人取全部在训成员，因此可以跨组指派，支持一个人兼任多组队长/教练
async function actionAdminGroupStaff(userId, data) {
  await requireAdmin(userId);
  const groupId = String(data.groupId || '');
  if (!groupId) return fail('缺少组别');

  const gRes = await db.collection('winter_group').limit(50).get().catch(() => null);
  const gName = {};
  for (const g of ((gRes && gRes.data) || [])) gName[g._id] = g.name;

  const out = [];
  for (const role of ['leader', 'coach']) {
    const ids = await groupStaffUserIds(groupId, [role]);
    for (const uid of ids) out.push(await staffBrief(uid, groupId, role, gName, true));
  }

  // 候选人：在训成员（含其他组的，用于兼任）
  const mr = await db.collection('winter_member')
    .where({ status: _.in(['approved', 'quit-suggested']) }).limit(500).get().catch(() => null);
  const candidates = [];
  for (const m of ((mr && mr.data) || [])) {
    if (!m.userId) continue;
    const u = await getUser(m.userId);
    candidates.push({
      userId: m.userId,
      nickName: (u && (u.nickName || u.nickname)) || m.nickName || '未知',
      ownGroupName: gName[m.groupId] || '',
      ownRole: m.role, ownRoleText: ROLE_TEXT[m.role] || '',
      role: await roleInGroup(m.userId, groupId),   // 已在本组担任的职务
    });
  }
  return ok({ groupId, groupName: gName[groupId] || '', staff: out, candidates });
}

async function staffBrief(uid, groupId, role, gName, withLog) {
  const u = await getUser(uid);
  const m = await getMyMember(uid);
  return {
    userId: uid, role, roleText: ROLE_TEXT[role] || '',
    nickName: (u && (u.nickName || u.nickname)) || (m && m.nickName) || '未知',
    ownGroupName: gName[(m && m.groupId) || ''] || '',
    sameGroup: !!m && m.groupId === groupId,   // true=本组成员升任；false=跨组兼任
  };
}

// 后台：指派 / 撤销某人在某组的队长或教练职务
async function actionAdminSetStaff(userId, data) {
  await requireAdmin(userId);
  const groupId = String(data.groupId || '');
  const targetId = String(data.userId || '');
  const role = String(data.role || '');
  const remove = data.remove === true;
  if (!groupId || !targetId || !['leader', 'coach'].includes(role)) return fail('参数不完整');

  const t = await getMyMember(targetId);
  if (!t) return fail('该成员记录不存在');
  const exist = await db.collection('winter_staff')
    .where({ userId: targetId, groupId }).limit(5).get().catch(() => null);
  const cur = (exist && exist.data) || [];

  if (remove) {
    for (const d of cur) await db.collection('winter_staff').doc(d._id).remove().catch(() => {});
    // 主记录就在本组且正是这个职务：同步降为队员，避免主记录与指派不一致
    if (t.groupId === groupId && t.role === role) {
      await db.collection('winter_member').doc(targetId)
        .update({ data: { role: 'member', updateTime: new Date() } }).catch(() => {});
    }
    await saveLog({ type: 'staff', action: 'remove', operatorId: userId, targetUserId: targetId, groupId, detail: role });
    return ok({ removed: true });
  }

  // 教练唯一：同一组已有教练（主记录或指派）时先清掉旧的
  if (role === 'coach') {
    const old = await groupStaffUserIds(groupId, ['coach']);
    for (const uid of old) {
      if (uid === targetId) continue;
      const r = await db.collection('winter_staff').where({ userId: uid, groupId }).limit(5).get().catch(() => null);
      for (const d of ((r && r.data) || [])) await db.collection('winter_staff').doc(d._id).remove().catch(() => {});
      const om = await getMyMember(uid);
      if (om && om.groupId === groupId && om.role === 'coach') {
        await db.collection('winter_member').doc(uid).update({ data: { role: 'member', updateTime: new Date() } }).catch(() => {});
      }
    }
  }
  if (cur.length) {
    await db.collection('winter_staff').doc(cur[0]._id)
      .update({ data: { role, updateTime: new Date() } }).catch(() => {});
  } else {
    await db.collection('winter_staff').add({
      data: { userId: targetId, groupId, role, createTime: new Date(), updateTime: new Date() },
    }).catch(() => {});
  }
  await saveLog({ type: 'staff', action: 'set', operatorId: userId, targetUserId: targetId, groupId, detail: role });
  return ok({ ok: true, role });
}

// 报名审核列表
async function actionAdminApplies(userId, data) {
  await requireAdmin(userId);
  const status = String(data.status || 'pending');
  const r = await db.collection('winter_member').where({ status }).limit(200).get().catch(() => null);
  const list = (r && r.data) || [];
  // 队员/教练的入队申请由本组队长在「待审」页审批；管理组只处理队长任命
  // 管理组处理：队长任命 + 没有队长的组的入队申请（applyReviewer=admin）
  const scoped = status === 'pending'
    ? list.filter(m => m.role === 'leader' || m.applyReviewer === 'admin')
    : list;
  const out = [];
  for (const m of scoped) {
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
      feeStatus: m.feeStatus || 'unpaid',
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
  const updateData = await applyGroupFreeFee(
    { status: 'approved', groupId: finalGroupId, rejectReason: '', updateTime: new Date() }, finalGroupId);
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
  // 规则：转组不重复交费，连续未完成周数默认【不清零】；
  // 仅当管理组明确传 clearFail=true（如确认伤病代管等特殊情形）才清零
  const clearFail = data.clearFail === true || String(data.clearFail) === 'true';
  // 目标角色：调过去当队员还是队长/教练（默认队员）
  const newRole = ['leader', 'coach', 'member'].indexOf(data.newRole) >= 0 ? data.newRole : 'member';
  if (!targetId || !newGroupId) return fail('缺少成员或目标组别');
  if (!reason) return fail('请填写调整原因');
  const m = await getMyMember(targetId);
  if (!m) return fail('成员不存在');
  const g = await db.collection('winter_group').doc(newGroupId).get().catch(() => null);
  if (!g || !g.data) return fail('目标组别不存在');
  if (g.data.capacity) {
    const cnt = await db.collection('winter_member').where({ groupId: newGroupId, status: 'approved' }).count().catch(() => ({ total: 0 }));
    if ((cnt.total || 0) >= g.data.capacity) return fail('目标组别人数已满');
  }
  // 队长/教练在一个组里只能有一个（排除本人）：跨组兼任走「组别职务指派」，不走调组
  if (newRole !== 'member') {
    const dup = await db.collection('winter_member').where({
      groupId: newGroupId, role: newRole, status: 'approved', userId: _.neq(targetId),
    }).count().catch(() => ({ total: 0 }));
    if ((dup.total || 0) > 0) return fail(`目标组别已有${ROLE_TEXT[newRole]}`);
  }
  // 换组后区间不同，清掉原 KPI：必须在新组按新区间重新填报
  const updateData = await applyGroupFreeFee({
    groupId: newGroupId, role: newRole, updateTime: new Date(),
    kpiType: '', kpiValue: 0, kpiWeek: 0, kpiSubmitTime: null,
  }, newGroupId);
  if (clearFail) updateData.continuousFailWeeks = 0;
  await db.collection('winter_member').doc(targetId).update({ data: updateData });
  // 备注写入（伤病/调整原因）
  if (data.saveRemark !== false) {
    await db.collection('winter_member').doc(targetId).update({
      data: { remark: reason, remarkTime: new Date() },
    }).catch(() => {});
  }
  // 主记录已挪到新组：原来在旧组的兼任指派一并撤掉，避免换组后还握着旧组权限
  const old = await db.collection('winter_staff').where({ userId: targetId, groupId: _.neq(newGroupId) }).limit(100).get().catch(() => null);
  for (const s of ((old && old.data) || [])) {
    await db.collection('winter_staff').doc(s._id).remove().catch(() => {});
  }
  await saveLog({
    type: 'transfer', action: 'move', operatorId: userId, targetUserId: targetId,
    fromGroupId: m.groupId, toGroupId: newGroupId,
    fromRole: m.role, newRole, clearFail, remark: reason,
    effectiveDate: String(data.effectiveDate || todayStr()),
  });
  return ok({ groupId: newGroupId, role: newRole });
}

// 删除组别（超管）
// 空组直接删；组里还有人时先返回人数让前端二次确认，确认后才解散，并把成员置为「未分组」
// 打卡记录只做留档不删，业务报表仍查得到历史数据
async function actionAdminDeleteGroup(userId, data) {
  await requireAdmin(userId);
  const groupId = String(data.groupId || '').trim();
  if (!groupId) return fail('缺少组别');
  const g = await db.collection('winter_group').doc(groupId).get().catch(() => null);
  if (!g || !g.data) return fail('组别不存在');

  const mRes = await db.collection('winter_member').where({ groupId }).limit(500).get().catch(() => null);
  const members = (mRes && mRes.data) || [];
  // 已退出/已拒绝的不算在内：他们本来就脱离了这个组
  const active = members.filter(m => !['quit', 'rejected'].includes(m.status));

  const confirm = data.confirm === true || String(data.confirm) === 'true';
  if (active.length && !confirm) {
    const staff = active.filter(m => ['leader', 'coach'].includes(m.role)).map(m => ROLE_TEXT[m.role]);
    return ok({ needConfirm: true, name: g.data.name, count: active.length, staff });
  }

  for (const m of active) {
    await db.collection('winter_member').doc(m._id).update({
      data: {
        groupId: '', role: 'member',
        // 组都没了，KPI 自然作废；缴费状态保留（已收的钱不因为删组被抹掉）
        kpiType: '', kpiValue: 0, kpiWeek: 0, kpiSubmitTime: null,
        updateTime: new Date(),
      },
    }).catch(() => {});
  }
  // 撤掉挂在这个组上的跨组职务指派，否则人走了权限还在
  const st = await db.collection('winter_staff').where({ groupId }).limit(200).get().catch(() => null);
  for (const s of ((st && st.data) || [])) {
    await db.collection('winter_staff').doc(s._id).remove().catch(() => {});
  }
  await db.collection('winter_group').doc(groupId).remove().catch(() => {});
  await saveLog({
    type: 'group', action: 'delete', operatorId: userId, fromGroupId: groupId,
    detail: `删除组别「${g.data.name}」${active.length ? `，${active.length} 名成员转为未分组` : ''}`,
  });
  return ok({ deleted: true, movedOut: active.length });
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
  // 试运行阶段：不计连续、不结算榜单、不罚款（11/1—11/15）
  // 试运行期照常考核，仅春节周跳过考核
  const frozen = cfg.phase === 'holiday' || isHolidayWeek(cfg, weekIndex);
  // 周次相关的固定规则（循环外计算一次）
  const warnWeek = Number(cfg.warnWeek) || 0;                 // 正式第1周：只提醒不罚、不累加连续
  const tailWeek = Number(cfg.tailWeek) || 0;                 // 收尾降档起始周
  const tailOnce = cfg.tailPassOnce !== false && tailWeek > 0 && weekIndex >= tailWeek;
  const all = await db.collection('winter_member').where({ status: _.in(['approved', 'quit-suggested']) }).limit(500).get().catch(() => null);
  const members = (all && all.data) || [];

  let failCnt = 0, doneCnt = 0, fineTotal = 0;
  for (const m of members) {
    const cr = await db.collection('winter_checkin').where({ userId: m.userId, weekIndex }).limit(100).get().catch(() => null);
    const list = ((cr && cr.data) || []).filter(c => c.status === 'approved');
    const totalDistance = list.reduce((s, c) => s + toNum(c.distance), 0);
    const days = new Set(list.map(c => c.date)).size;
    // 周 KPI：结算时用该成员「这一周」的目标
    const wkt = await getWeekKpi(m, weekIndex);
    const target = wkt.value;
    let actual = 0, rate = 0;
    if (target > 0) {
      actual = wkt.type === 'attendance' ? days : totalDistance;
      rate = Math.min(1, actual / target);
    }
    // 收尾降档周（规则 2/17—2/23，跨第 14、15 周）：自 tailWeek 起自动降档，完成 1 次即达标
    const oncePass = tailOnce && days >= 1;
    // 冻结周（试运行/春节）完成状态记为 null = 不考核，不虚增完成周数
    const completed = frozen ? null : (oncePass || (target > 0 && rate >= 1));
    // 更新连续未完成（春节/试运行周冻结；警告周只提醒，不累加连续，保证 11/23 计罚从 5 元起）
    let continuousFailWeeks = m.continuousFailWeeks || 0;
    if (!frozen) {
      if (!completed && target > 0) {
        if (weekIndex !== warnWeek) continuousFailWeeks += 1;
      } else if (completed) continuousFailWeeks = 0;
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
    // 小红包提醒：仅未完成 + 非冻结周 + 非警告周（正式第 1 周只提醒不罚）
    const noFine = frozen || weekIndex === warnWeek;
    if (!completed && target > 0 && !noFine) {
      const fineExist = await db.collection('winter_fine').where({ userId: m.userId, weekIndex }).limit(1).get().catch(() => null);
      if (!(fineExist && fineExist.data && fineExist.data.length)) {
        // 金额按「连续未完成周数」取档：第1周5元、第2周10元、第3周及以上20元封顶
        const tiers = Array.isArray(cfg.fineTiers) && cfg.fineTiers.length ? cfg.fineTiers : [5, 10, 20];
        const idx = Math.max(0, Math.min(tiers.length - 1, continuousFailWeeks - 1));
        const amount = toNum(tiers[idx]);
        // 红包个数：默认 5 个拼手气；组内人数少于 6 时按「人数-1」发
        const gmCnt = await db.collection('winter_member')
          .where({ groupId: m.groupId, status: _.in(['approved', 'quit-suggested']) }).count().catch(() => ({ total: 0 }));
        const memberCount = gmCnt.total || 0;
        let packets = toNum(cfg.finePackets) || 5;
        if (memberCount >= 2 && memberCount - 1 < packets) packets = memberCount - 1;
        await db.collection('winter_fine').add({
          data: {
            userId: m.userId, groupId: m.groupId, weekIndex,
            continuousFailWeeks, amount, packets,
            status: 'due', createTime: new Date(),
          },
        });
        fineTotal += amount;
      }
      failCnt++;
    } else if (completed) {
      doneCnt++;
    }
  }
  await saveLog({ type: 'weekly', action: 'calc', operatorId: userId, detail: `第${weekIndex}周结算：完成${doneCnt}人，未完成${failCnt}人，罚金${fineTotal}元` });
  return ok({ weekIndex, frozen, done: doneCnt, failed: failCnt, fineTotal });
}

// 阶段开关（试运行/正式/春节假期）
// 清理试运行数据：试运行期照常考核，但正式开始时全部作废重来
// 清除范围：第 0 周（开营前）的打卡、周统计、罚金；成员 KPI 与连续未完成重置
// 保留范围：报名记录、分组、角色、缴费状态、群组配置
async function cleanupTrialData() {
  const res = { checkin: 0, weekly: 0, fine: 0, members: 0 };
  try {
    const r1 = await db.collection('winter_checkin').where({ weekIndex: _.lte(0) }).remove();
    res.checkin = (r1 && r1.stats && r1.stats.removed) || 0;
  } catch (e) { /* ignore */ }
  try {
    const r2 = await db.collection('winter_weekly').where({ weekIndex: _.lte(0) }).remove();
    res.weekly = (r2 && r2.stats && r2.stats.removed) || 0;
  } catch (e) { /* ignore */ }
  try {
    const r3 = await db.collection('winter_fine').where({ weekIndex: _.lte(0) }).remove();
    res.fine = (r3 && r3.stats && r3.stats.removed) || 0;
  } catch (e) { /* ignore */ }
  const ms = await db.collection('winter_member').limit(500).get().catch(() => null);
  for (const m of ((ms && ms.data) || [])) {
    await db.collection('winter_member').doc(m._id).update({
      data: {
        kpiType: '', kpiValue: 0, kpiWeek: 0, continuousFailWeeks: 0,
        kpiSubmitTime: null, updateTime: new Date(),
      },
    }).catch(() => {});
    res.members++;
  }
  return res;
}

async function actionAdminSetPhase(userId, data) {
  await requireAdmin(userId);
  const phase = String(data.phase || '');
  if (!['closed', 'trial', 'formal', 'holiday'].includes(phase)) return fail('阶段值不合法');
  const update = { phase, updateTime: new Date() };
  if (data.signupOpen !== undefined) update.signupOpen = !!data.signupOpen;
  if (data.startMonday !== undefined) update.startMonday = String(data.startMonday || '');
  if (data.totalWeeks !== undefined) update.totalWeeks = Number(data.totalWeeks) || 15;
  if (data.holidayWeeks !== undefined) {
    update.holidayWeeks = Array.isArray(data.holidayWeeks) ? data.holidayWeeks.map(Number).filter(n => !isNaN(n)) : [];
  }
  // 小红包梯度（如 [5,10,20]）
  if (data.fineTiers !== undefined) {
    update.fineTiers = Array.isArray(data.fineTiers) ? data.fineTiers.map(Number).filter(n => !isNaN(n)) : [];
  }
  if (data.finePackets !== undefined) update.finePackets = Number(data.finePackets) || 5;
  if (data.warnWeek !== undefined) update.warnWeek = Number(data.warnWeek) || 0;
  if (data.tailWeek !== undefined) update.tailWeek = Number(data.tailWeek) || 0;
  if (data.scale !== undefined) update.scale = data.scale;
  if (data.intro !== undefined) update.intro = String(data.intro || '');
  if (data.rulesText !== undefined) update.rulesText = String(data.rulesText || '');
  if (data.fee !== undefined) update.fee = data.fee;
  const oldCfg = await getConfig();
  await db.collection('winter_config').doc(CONFIG_ID).update({ data: update }).catch(async () => {
    await db.collection('winter_config').add({ data: { _id: CONFIG_ID, ...update } });
  });
  await saveLog({ type: 'phase', action: 'set', operatorId: userId, detail: phase });

  // 切入正式阶段：清空试运行期间产生的考核数据（可传 cleanupTrial:false 跳过）
  let cleaned = null;
  if (phase === 'formal' && oldCfg.phase !== 'formal' && data.cleanupTrial !== false) {
    cleaned = await cleanupTrialData();
    await saveLog({ type: 'phase', action: 'cleanup-trial', operatorId: userId, detail: JSON.stringify(cleaned) });
  }
  return ok({ phase, cleaned });
}

// 费用与奖池
async function actionAdminFinance(userId, data) {
  await requireAdmin(userId);
  const cfg = await getConfig();
  const members = await db.collection('winter_member').where({ status: _.in(['approved', 'quit-suggested']) }).limit(500).get().catch(() => null);
  const list = (members && members.data) || [];
  // 免费（free）的人不产生费用，不计入应收与奖池合计
  const paying = list.filter(m => m.feeStatus !== 'free');
  const paid = paying.filter(m => m.feeStatus === 'paid');
  const perFee = toNum(cfg.fee.entry) + toNum(cfg.fee.coach) + toNum(cfg.fee.pool);
  const feeTotal = paying.length * perFee;
  const poolTotal = paying.length * toNum(cfg.fee.pool);
  const fines = await db.collection('winter_fine').limit(500).get().catch(() => null);
  const fineList = (fines && fines.data) || [];
  const fineDue = fineList.filter(f => f.status === 'due').reduce((s, f) => s + toNum(f.amount), 0);
  const finePaid = fineList.filter(f => f.status === 'paid').reduce((s, f) => s + toNum(f.amount), 0);
  return ok({
    fee: cfg.fee, memberCount: list.length, paidCount: paid.length,
    freeCount: list.length - paying.length,
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
      case 'quitGroup': return await actionQuitGroup(userId, data);
      case 'myGroup': return await actionGetMyGroup(userId);
      case 'setKpiRange': return await actionSetKpiRange(userId, data);
      case 'submitKpi': return await actionSubmitKpi(userId, data);
      case 'checkin': return await actionDoCheckin(userId, data);
      case 'myCheckins': return await actionMyCheckins(userId, data);
    case 'groupCheckins': return await actionGroupCheckins(userId, data);
    case 'leaderApplies': return await actionLeaderApplies(userId);
    case 'leaderReviewApply': return await actionLeaderReviewApply(userId, data);
    case 'setFeeStatus': return await actionSetFeeStatus(userId, data);
    case 'leaderSaveGroup': return await actionLeaderSaveGroup(userId, data);
    case 'transferRole': return await actionTransferRole(userId, data);
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
      case 'adminGroupStaff': return await actionAdminGroupStaff(userId, data);
      case 'adminSetStaff': return await actionAdminSetStaff(userId, data);
    case 'adminDeleteGroup': return await actionAdminDeleteGroup(userId, data);
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
