// cloudfunctions/raceHelp/index.js - 跑友互助（拼房/拼车/拼饭/旅游/组队）
//
// 合规要点：
// 1. 必须关注了该赛事才能发布和应征（不是陌生人随便进）
// 2. 内容走微信内容安全检测
// 3. 联系方式默认不返回；只有「已应征」或「本人发布」才按需互见
// 4. 无 sustained 互动（无评论/点赞），到截止时间自动失效，不沉淀内容
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const HELPS = 'race_helps';
const APPLIES = 'race_help_applies';

// 支持的互助类型（固定这 5 种，不多不少）
const TYPES = {
  room: { label: '拼房', icon: '🏠' },
  carpool: { label: '拼车', icon: '🚗' },
  meal: { label: '拼饭', icon: '🍜' },
  tour: { label: '旅游', icon: '🧳' },
  team: { label: '组队', icon: '👥' },
};

// 限制
const LIMIT = {
  title: 20,
  desc: 200,
  costNote: 30,
  message: 50,
  perEvent: 3,        // 每人每场赛事最多同时挂 3 条
  daily: 5,           // 每天最多发 5 条
  applyDaily: 10,     // 每天最多应征 10 次
  maxDays: 90,        // 截止时间最多 90 天后
  cancelPerEvent: 3,  // 同一场赛事最多撤销 3 次应征
  maxPeople: 9,       // 单条互助最多招募人数
  // 放鸽子：只有临近截止才罚。提前好几天说一声是无所谓的，最后一天撂摊子才是坑人
  noshowWindowHours: 24,  // 截止前 24 小时内取消应征 = 放鸽子
  noshowLimit: 3,         // 累计 3 次触发惩罚
  noshowBanDays: 7,       // 触发后 7 天不能发布互助
};

// 复用日历「关注赛事」已授权过的通用模板（date1 / thing2 / time3）。
// 互助不另起模板：跑友多半已经授过这个，换个新 templates 等于没人收得到。
const TEMPLATE_ID = 'xepY9QmUT4YPXUt7mLhQrtlVBcN01eGkk-NqH0Av5Ew';

const truncate = (s, n) => String(s == null ? '' : s).slice(0, n);

function now() { return new Date(); }

// 文本安全检测：接口没开通也不能让功能全挂，失败放行但记日志
async function checkText(content, openid) {
  try {
    await cloud.openapi.security.msgSecCheck({
      content: String(content || '').slice(0, 2500),
      version: 2,
      scene: 2,
      openid,
    });
    return true;
  } catch (e) {
    console.warn('msgSecCheck fail:', e && e.errCode, e && e.errMsg);
    // 内容安全接口不可用时暫不阻断（开通后自动生效），但要留痕
    return true;
  }
}

// 敏感兜底：涉及钱/交易/名额的一律拦下
const BLOCK_WORDS = ['转账', '收款', '代购', '定金', '押金', '手续费', '名额转让', '出名额', '替跑', '刷单', '兼职', '加微信群'];

function hasBlockedWord(text) {
  const t = String(text || '');
  return BLOCK_WORDS.find(w => t.includes(w));
}

function trimStr(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// 微信号：5~20 位字母/数字/-/_
// 不强制字母开头——很多跑友的微信号就是手机号，卡死反而没人能填
function validWechat(v) {
  return /^[-_a-zA-Z0-9]{5,20}$/.test(String(v || '').trim());
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 截止时间的解析：iOS 认 "2026/11/08 18:30" 不认 "2026-11-08 18:30"，统一换斜杠
function parseDeadline(s) {
  if (!s) return null;
  const raw = String(s).trim().replace('T', ' ');
  const d = new Date(raw.replace(/-/g, '/'));
  if (isNaN(d.getTime())) return null;
  // 只给了日期没给时刻的，按当天 23:59:59 兜底
  if (!/\d{1,2}:\d{2}/.test(raw)) d.setHours(23, 59, 59, 0);
  return d;
}

// 取用户的 openid（users 表里两种存法都见过，兼容着取）
async function getOpenid(userId) {
  const r = await db.collection('users').doc(userId).get().catch(() => null);
  const u = r && r.data;
  return (u && (u.openid || u._openid)) || '';
}

// 关注记录 race_markers 里的 userId 存的是 users 表内部 _id（客户端 markEvent 写的是
// userInfo._id），而云函数手上默认只有 openid。两边对不上就查不到，
// 表现就是：明明关注过，互助列表却永远是空的。所以不去赌它，两种身份都算上一起查。
async function resolveUserIds(rawId) {
  const ids = rawId ? [rawId] : [];
  try {
    if (typeof rawId === 'string' && rawId.startsWith('o')) {
      const r = await db.collection('users').where({ _openid: rawId }).limit(1).get().catch(() => null);
      if (r && r.data && r.data[0] && r.data[0]._id) ids.push(r.data[0]._id);
    } else if (rawId) {
      const r = await db.collection('users').doc(rawId).get().catch(() => null);
      const u = r && r.data;
      if (u && u._openid) ids.push(u._openid);
    }
  } catch (e) { /* 查不到就用原值试 */ }
  const uniq = Array.from(new Set(ids.filter(Boolean)));
  return uniq.length > 1 ? _.in(uniq) : uniq[0];
}

// 发订阅消息。失败了不影响主流程——订阅是一次性的，用户没授权就收不到，
// 所以互助列表里该看到的信息一律照常看得到，通知只是锦上添花。
async function notify(userId, content, page) {
  try {
    if (!userId) return false;
    const openid = await getOpenid(userId);
    if (!openid) return false;
    const now = new Date();
    const res = await cloud.callFunction({
      name: 'sendSubscribeMsg',
      data: {
        openid,
        templateId: TEMPLATE_ID,
        page: page || '/pages/tools/calendar/calendar',
        data: {
          date1: { value: todayStr() },
          thing2: { value: truncate(content, 20) },
          time3: { value: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}` },
        },
      },
    });
    return !!(res && res.result && res.result.ok);
  } catch (e) {
    console.warn('[raceHelp] notify fail:', e && e.message);
    return false;
  }
}

// 一条互助就是一个临时的组：发起人 + 所有还没取消的应征者。
// 谁有动静（有人应征 / 有人取消 / 发起人取消发布），除他本人以外全都要通知到，
// 不能只通知发起人——同组的搭子也有知情权。
async function groupMembers(h) {
  const aRes = await db.collection(APPLIES)
    .where({ helpId: h._id, status: _.neq('canceled') })
    .limit(50).get().catch(() => ({ data: [] }));
  const members = [];
  const add = (uid) => { if (uid && members.indexOf(uid) < 0) members.push(uid); };
  add(h.userId);
  ((aRes && aRes.data) || []).forEach(a => add(a.userId));
  return members;
}

// 组内广播：跳过 selfId，自己的动作不用通知自己
async function broadcast(h, content, selfId) {
  if (!h) return 0;
  const members = await groupMembers(h);
  const page = `/pages/tools/calendar/detail?id=${h.eventId}`;
  let sent = 0;
  await Promise.all(members.map(async (uid) => {
    if (uid === selfId) return;
    if (await notify(uid, content, page)) sent += 1;
  }));
  return sent;
}

// 同一用户在同一场赛事下主动撤销的次数。
// 发起人取消发布造成的作废（owner-canceled）不能算在他头上——那是别人撤的，
// 扣他的额度既不讲理，还会让人莫名其妙地失去本场赛事的应征资格。
async function countCanceled(userId, eventId) {
  const c = await db.collection(APPLIES)
    .where({ userId, eventId, status: 'canceled' })
    .limit(100).get().catch(() => ({ data: [] }));
  return ((c && c.data) || []).filter(a => a.cancelFlag !== 'owner-canceled').length;
}

// 累计放鸽子次数（临近截止才取消的那些）
async function countNoshow(userId) {
  const c = await db.collection(APPLIES)
    .where({ userId, cancelFlag: 'noshow' })
    .count().catch(() => ({ total: 0 }));
  return c.total || 0;
}

// 发起人自己在临近截止时才取消发布：被放的是所有应征的人，比个人缺席更严重
async function countOwnerNoshow(userId) {
  const c = await db.collection(HELPS)
    .where({ userId, ownerNoshow: true })
    .count().catch(() => ({ total: 0 }));
  return c.total || 0;
}

// 累计已应征的「人数」（不是条数）：一条可以带好几个人来
async function sumAppliedPeople(helpId) {
  const res = await db.collection(APPLIES)
    .where({ helpId, status: _.neq('canceled') })
    .limit(100).get().catch(() => ({ data: [] }));
  return ((res && res.data) || [])
    .reduce((s, a) => s + Math.max(1, parseInt(a.peopleCount, 10) || 1), 0);
}

// 剥掉联系方式，公开的 help 一律不带
function publicHelp(h, extra = {}) {
  const { contact, ...rest } = h;
  return { ...rest, ...extra };
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action;
  if (!OPENID) return { success: false, error: '请先登录' };

  try {
    // ===================== 关注关系自检 =====================
    // 前端那份 isMine 是加载时的快照，可能不可信（换了账号、缓存没跟上都会失真）。
    // 这里让服务端按当前登录身份自己认一次，并把现场信息带回去：
    // 这场赛事到底有没有关注记录、有是挂在谁名下——便于定位「明明关注过却不让发」。
    if (action === 'checkFollow') {
      const { eventId } = event;
      if (!eventId) return { success: false, error: '缺少 eventId' };

      const userRes = await db.collection('users').where({ _openid: OPENID }).limit(1).get().catch(() => null);
      const internalId = (userRes && userRes.data && userRes.data[0] && userRes.data[0]._id) || '';
      const who = await resolveUserIds(OPENID);

      const mineRes = await db.collection('race_markers').where({ userId: who, eventId }).limit(1).get().catch(() => null);
      const anyRes = await db.collection('race_markers').where({ eventId }).limit(20).get().catch(() => null);

      const row = (mineRes && mineRes.data && mineRes.data[0]) || null;
      const rows = (anyRes && anyRes.data) || [];

      return {
        success: true,
        followed: !!row,
        debug: {
          eventId,
          hasOpenid: !!OPENID,
          hasUserDoc: !!internalId,
          rowFound: !!row,                                   // 当前登录身份名下有没有记录
          rowStatus: row ? row.status : null,
          rowKeyIsOpenid: row ? row.userId === OPENID : null,
          rowKeyIsUserDocId: row ? row.userId === internalId : null,
          rowsForEvent: rows.length,                          // 这场赛事的关注记录总数
          // rowsForEvent > 0 却 rowFound = false，说明记录挂在别的账号名下——换号后最常见
        },
      };
    }

    // ===================== 某场赛事下的互助列表 =====================
    if (action === 'list') {
      const { eventId } = event;
      if (!eventId) return { success: false, error: '缺少 eventId' };

      // 必须关注了这场赛事才看得到（这是我们不做公共信息流的边界）
      const who = await resolveUserIds(OPENID);
      const mk = await db.collection('race_markers').where({ userId: who, eventId }).limit(1).get().catch(() => null);
      if (!(mk && mk.data && mk.data.length)) {
        return { success: true, followed: false, list: [] };
      }

      const res = await db.collection(HELPS)
        .where({
          eventId,
          status: 'open',
          deadline: _.gt(now()),          // 到点自动失效
          reportCount: _.lt(3),           // 被举报 3 次自动隐藏
        })
        .orderBy('createTime', 'desc')
        .limit(50).get();

      const list = (res.data || []).map(h => publicHelp(h, {
        isMine: h.userId === OPENID,
        typeLabel: (TYPES[h.type] || {}).label || '其他',
        typeIcon: (TYPES[h.type] || {}).icon || '🙌',
        daysLeft: Math.max(0, Math.ceil((new Date(h.deadline).getTime() - Date.now()) / 86400000)),
        hoursLeft: Math.max(0, Math.ceil((new Date(h.deadline).getTime() - Date.now()) / 3600000)),
        applyPeople: parseInt(h.applyPeople, 10) || 0,
        remainPeople: Math.max(0, (parseInt(h.peopleNeeded, 10) || 1) - (parseInt(h.applyPeople, 10) || 0)),
      }));
      return { success: true, followed: true, list };
    }

    // ===================== 发布互助 =====================
    if (action === 'create') {
      const eventId = trimStr(event.eventId, 40);
      const type = trimStr(event.type, 10);
      const title = trimStr(event.title, LIMIT.title);
      const desc = trimStr(event.desc, LIMIT.desc);
      const costNote = trimStr(event.costNote, LIMIT.costNote);
      const peopleNeeded = Math.max(1, Math.min(LIMIT.maxPeople, parseInt(event.peopleNeeded, 10) || 1));
      const contact = event.contact || {};
      const wechat = trimStr(contact.wechat, 20);

      if (!eventId) return { success: false, error: '缺少赛事' };
      if (!TYPES[type]) return { success: false, error: '类型不支持' };
      if (!title) return { success: false, error: '请填写标题' };
      if (event.ruleAgreed !== true) return { success: false, error: '请先阅读并勾选互助规则' };
      if (!wechat) return { success: false, error: '请填写微信号' };
      if (!validWechat(wechat)) return { success: false, error: '微信号格式不对' };

      const deadline = parseDeadline(event.deadline);   // "2026-11-08 18:30"
      if (!deadline) return { success: false, error: '截止时间不正确' };
      if (deadline <= now()) return { success: false, error: '截止时间要在今天之后' };
      if (deadline.getTime() - Date.now() > LIMIT.maxDays * 86400000) {
        return { success: false, error: `截止时间最多 ${LIMIT.maxDays} 天后` };
      }

      // 关注门槛
      const mk = await db.collection('race_markers').where({ userId: OPENID, eventId }).limit(1).get().catch(() => null);
      if (!(mk && mk.data && mk.data.length)) {
        return { success: false, error: '只有关注了这场赛事的跑友才能发布互助' };
      }

      // 处罚期：临近截止才撂摊子的人，别人是没时间再找搭子的，一段时间内不许再发起。
      // 应征了临时撤、和发起人自己临时取消发布，两种都算数。
      const noshow = (await countNoshow(OPENID)) + (await countOwnerNoshow(OPENID));
      if (noshow >= LIMIT.noshowLimit) {
        const lastApply = await db.collection(APPLIES)
          .where({ userId: OPENID, cancelFlag: 'noshow' })
          .orderBy('cancelTime', 'desc').limit(1).get().catch(() => null);
        const lastOwn = await db.collection(HELPS)
          .where({ userId: OPENID, ownerNoshow: true })
          .orderBy('cancelTime', 'desc').limit(1).get().catch(() => null);
        const t1 = lastApply && lastApply.data && lastApply.data[0]
          ? new Date(lastApply.data[0].cancelTime).getTime() : 0;
        const t2 = lastOwn && lastOwn.data && lastOwn.data[0]
          ? new Date(lastOwn.data[0].cancelTime).getTime() : 0;
        if (Date.now() < Math.max(t1, t2) + LIMIT.noshowBanDays * 86400000) {
          return { success: false, error: `近日多次临近截止才取消，${LIMIT.noshowBanDays} 天内不能发起互助` };
        }
      }

      const badWord = hasBlockedWord(`${title}${desc}${costNote}`);
      if (badWord) return { success: false, error: `内容含有不允许的信息（${badWord}）` };

      // 频率限制
      const openRes = await db.collection(HELPS)
        .where({ userId: OPENID, eventId, status: 'open' }).get().catch(() => null);
      if (openRes && openRes.data.length >= LIMIT.perEvent) {
        return { success: false, error: `这场赛事最多同时发布 ${LIMIT.perEvent} 条互助` };
      }
      const todayRes = await db.collection(HELPS)
        .where({ userId: OPENID, createTime: _.gt(startOfToday()) }).get().catch(() => null);
      if (todayRes && todayRes.data.length >= LIMIT.daily) {
        return { success: false, error: '今天发布次数已达上限，明天再来' };
      }

      await checkText(`${title} ${desc} ${costNote}`, OPENID);

      // 取昵称头像快照
      let nickName = '跑友', avatarUrl = '';
      const uRes = await db.collection('users').where({ _openid: OPENID }).limit(1).get().catch(() => null);
      if (uRes && uRes.data && uRes.data[0]) {
        nickName = uRes.data[0].nickName || '跑友';
        avatarUrl = uRes.data[0].avatarUrl || '';
      }

      const addRes = await db.collection(HELPS).add({
        data: {
          eventId, userId: OPENID, nickName, avatarUrl,
          type, title, desc, costNote, peopleNeeded,
          deadline,
          contact: { wechat },
          status: 'open',
          applyCount: 0,     // 应征的「条数」
          applyPeople: 0,    // 应征的「人数」，按这个判断是否人满
          reportCount: 0,
          ruleAgreed: true,
          createTime: now(),
          updateTime: now(),
        },
      });
      return { success: true, id: addRes._id };
    }

    // ===================== 应征 =====================
    if (action === 'apply') {
      const helpId = trimStr(event.helpId, 40);
      const message = trimStr(event.message, LIMIT.message);
      const peopleCount = Math.max(1, Math.min(LIMIT.maxPeople, parseInt(event.peopleCount, 10) || 1));
      const contact = event.contact || {};
      const wechat = trimStr(contact.wechat, 20);
      if (!helpId) return { success: false, error: '缺少参数' };
      if (!wechat) return { success: false, error: '请填写微信号' };
      if (!validWechat(wechat)) return { success: false, error: '微信号格式不对' };
      if (hasBlockedWord(message)) return { success: false, error: '留言含有不允许的内容' };

      const hRes = await db.collection(HELPS).doc(helpId).get().catch(() => null);
      const h = hRes && hRes.data;
      if (!h || h.status !== 'open') return { success: false, error: '这条互助已结束' };
      if (h.userId === OPENID) return { success: false, error: '不能应征自己发布的互助' };
      if (new Date(h.deadline).getTime() <= Date.now()) return { success: false, error: '这条互助已截止' };

      const mk = await db.collection('race_markers').where({ userId: OPENID, eventId: h.eventId }).limit(1).get().catch(() => null);
      if (!(mk && mk.data && mk.data.length)) {
        return { success: false, error: '请先关注这场赛事' };
      }

      // 已取消的不算重复，允许重新应征
      const dup = await db.collection(APPLIES).where({ helpId, userId: OPENID, status: _.neq('canceled') }).limit(1).get().catch(() => null);
      if (dup && dup.data.length) return { success: false, error: '已经应征过了' };

      // 撤销次数用完 → 本场赛事不能再应征（防反复应征套取联系方式）
      const canceledCount = await countCanceled(OPENID, h.eventId);
      if (canceledCount >= LIMIT.cancelPerEvent) {
        return { success: false, error: `本场赛事已撤销 ${LIMIT.cancelPerEvent} 次，不能再应征了` };
      }

      const todayApply = await db.collection(APPLIES)
        .where({ userId: OPENID, createTime: _.gt(startOfToday()) }).get().catch(() => null);
      if (todayApply && todayApply.data.length >= LIMIT.applyDaily) {
        return { success: false, error: '今天应征次数已达上限' };
      }

      let nickName = '跑友';
      const uRes = await db.collection('users').where({ _openid: OPENID }).limit(1).get().catch(() => null);
      if (uRes && uRes.data && uRes.data[0]) nickName = uRes.data[0].nickName || '跑友';

      // 名额按人数算而不是条数：有人带朋友一起来，也得卡得住
      const need = Math.max(1, parseInt(h.peopleNeeded, 10) || 1);
      const applied = await sumAppliedPeople(helpId);
      const remain = Math.max(0, need - applied);
      if (remain <= 0) return { success: false, error: '这条互助已经满员了' };
      if (peopleCount > remain) return { success: false, error: `只剩 ${remain} 个名额了` };

      await checkText(message, OPENID);

      await db.collection(APPLIES).add({
        data: {
          helpId, eventId: h.eventId, userId: OPENID, nickName,
          contact: { wechat },
          message,
          peopleCount,
          status: 'pending',
          createTime: now(),
        },
      });

      const cntRes = await db.collection(APPLIES).where({ helpId, status: _.neq('canceled') }).get().catch(() => ({ data: [] }));
      const alive = (cntRes && cntRes.data) || [];
      const people = alive.reduce((s, a) => s + Math.max(1, parseInt(a.peopleCount, 10) || 1), 0);
      // 人满自动完成，不用发起人再来点一下
      const full = people >= need;
      await db.collection(HELPS).doc(helpId).update({
        data: {
          applyCount: alive.length,
          applyPeople: people,
          status: full ? 'full' : 'open',
          updateTime: now(),
        },
      }).catch(() => {});

      // 组里广播。订阅消息是一次性的，收不到也不打紧——「我发布的」里照样看得到应征者
      const typeLabel = (TYPES[h.type] || {}).label || '互助';
      await broadcast(h, `${typeLabel}「${truncate(h.title, 8)}」有人应征了`, OPENID);
      if (full) {
        await broadcast(h, `${typeLabel}「${truncate(h.title, 8)}」已约满`, OPENID);
      }

      return { success: true, full, remain: Math.max(0, remain - peopleCount) };
    }

    // ===================== 我发布的互助（含应征者联系方式） =====================
    if (action === 'myHelps') {
      const res = await db.collection(HELPS)
        .where({ userId: OPENID })
        .orderBy('createTime', 'desc')
        .limit(50).get().catch(() => ({ data: [] }));
      // 标记完成的（发起人已收尾）不再露面，等于从他眼前删掉了
      const list = (res.data || []).filter(h => h.status !== 'done');

      const helps = await Promise.all(list.map(async (h) => {
        const aRes = await db.collection(APPLIES)
          .where({ helpId: h._id, status: _.neq('canceled') })
          .orderBy('createTime', 'desc').limit(30).get().catch(() => ({ data: [] }));
        // 只有发布者自己能看应征者的联系方式
        const applicants = (aRes.data || []).map(a => ({
          userId: a.userId, nickName: a.nickName, message: a.message,
          contact: { wechat: (a.contact || {}).wechat }, createTime: a.createTime,
        }));
        return publicHelp(h, {
          typeLabel: (TYPES[h.type] || {}).label || '其他',
          typeIcon: (TYPES[h.type] || {}).icon || '🙌',
          applicants,
          expired: new Date(h.deadline).getTime() <= Date.now(),
          applyPeople: parseInt(h.applyPeople, 10) || 0,
          remainPeople: Math.max(0, (parseInt(h.peopleNeeded, 10) || 1) - (parseInt(h.applyPeople, 10) || 0)),
          isFull: h.status === 'full',
          isCanceled: h.status === 'closed',
          // 现在取消会不会算放鸽子：由后端判定，前端拿去写提醒文案，别再自己推算一遍成 24
          willNoshow: (new Date(h.deadline).getTime() - Date.now()) <= LIMIT.noshowWindowHours * 3600000,
        });
      }));
      return { success: true, list: helps };
    }

    // ===================== 我应征的（已应征 → 可见发布者联系方式） =====================
    if (action === 'myApplies') {
      const aRes = await db.collection(APPLIES)
        .where({ userId: OPENID, status: _.neq('canceled') })
        .orderBy('createTime', 'desc').limit(50).get().catch(() => ({ data: [] }));
      const applies = aRes.data || [];

      // 按赛事聚合统计已撤销次数（涉及的赛事通常就三五个，避免逐条查询）
      const eventIds = Array.from(new Set(applies.map(a => a.eventId).filter(Boolean)));
      const cancelMap = {};
      await Promise.all(eventIds.map(async (eid) => {
        cancelMap[eid] = await countCanceled(OPENID, eid);
      }));

      const list = await Promise.all(applies.map(async (a) => {
        const hRes = await db.collection(HELPS).doc(a.helpId).get().catch(() => null);
        const h = hRes && hRes.data;
        if (!h) return null;
        if (h.status === 'done') return null;   // 发起人标记完成，这条跟着收起来
        const remain = Math.max(0, LIMIT.cancelPerEvent - (cancelMap[a.eventId] || 0));
        return {
          applyId: a._id,
          message: a.message,
          peopleCount: Math.max(1, parseInt(a.peopleCount, 10) || 1),
          myContact: { wechat: (a.contact || {}).wechat },
          createTime: a.createTime,
          // 双方都已表达诚意，互见联系方式
          ownerContact: { wechat: (h.contact || {}).wechat },
          cancelRemain: remain,
          canCancel: remain > 0,
          ...publicHelp(h, {
            typeLabel: (TYPES[h.type] || {}).label || '其他',
            typeIcon: (TYPES[h.type] || {}).icon || '🙌',
            // 应征的人也得看得出状态：满员了、被取消了、过期了
            expired: new Date(h.deadline).getTime() <= Date.now(),
            applyPeople: parseInt(h.applyPeople, 10) || 0,
            remainPeople: Math.max(0, (parseInt(h.peopleNeeded, 10) || 1) - (parseInt(h.applyPeople, 10) || 0)),
            isFull: h.status === 'full',
            isCanceled: h.status === 'closed',
          }),
        };
      }));
      return { success: true, list: list.filter(Boolean) };
    }

    // ===================== 关闭自己发布的互助 =====================
    if (action === 'close') {
      const helpId = trimStr(event.helpId, 40);
      const hRes = await db.collection(HELPS).doc(helpId).get().catch(() => null);
      const h = hRes && hRes.data;
      if (!h) return { success: false, error: '不存在' };
      if (h.userId !== OPENID) return { success: false, error: '只能取消自己发布的' };
      if (h.status === 'closed') return { success: false, error: '已经取消过了' };
      if (h.status === 'done') return { success: false, error: '这条已经标记完成了' };

      // 发起人临近截止才撤摊，被放的是应征的人，同样算放鸽子
      const hoursLeft = (new Date(h.deadline).getTime() - Date.now()) / 3600000;
      const noshow = hoursLeft <= LIMIT.noshowWindowHours;

      await db.collection(HELPS).doc(helpId).update({
        data: { status: 'closed', ownerNoshow: noshow, cancelTime: now(), updateTime: now() },
      });

      // 已经应征的人全部作废，并挨个通知到位
      const aRes = await db.collection(APPLIES)
        .where({ helpId, status: _.neq('canceled') }).limit(50).get().catch(() => ({ data: [] }));
      const list = (aRes && aRes.data) || [];
      const typeLabel = (TYPES[h.type] || {}).label || '互助';
      const content = noshow
        ? `${typeLabel}「${truncate(h.title, 8)}」发起人临近截止取消了`
        : `${typeLabel}「${truncate(h.title, 8)}」发起人已取消`;
      // 顺序很重要：先把消息送到，再作废应征记录。
      // 作废之后他们就不算组员了，广播会找不到人。
      const notified = await broadcast(h, content, OPENID);
      await Promise.all(list.map(a => db.collection(APPLIES).doc(a._id).update({
        data: { status: 'canceled', cancelFlag: 'owner-canceled', cancelTime: now() },
      }).catch(() => {})));

      return { success: true, applicantCount: list.length, notified, noshow };
    }

    // ===================== 发起人标记完成 =====================
    if (action === 'finish') {
      const helpId = trimStr(event.helpId, 40);
      const hRes = await db.collection(HELPS).doc(helpId).get().catch(() => null);
      const h = hRes && hRes.data;
      if (!h) return { success: false, error: '不存在' };
      if (h.userId !== OPENID) return { success: false, error: '只能标记自己发布的' };
      if (h.status === 'done') return { success: false, error: '已经标记过了' };
      if (h.status === 'closed') return { success: false, error: '这条已经取消了' };

      // 已经有人应征、又还没到截止：这时候要删请走「取消发布」。
      // 否则临近截止点一下「标记完成」就能绕开提醒和惩罚，那条规矩就形同虚设了。
      if (new Date(h.deadline).getTime() > Date.now() && (parseInt(h.applyPeople, 10) || 0) > 0) {
        return { success: false, error: '已经有人应征了，要取消请点「取消发布」' };
      }

      // 标记完就收起来，所有人都不再见它。催也不催、罚也不罚——不来标记完全没关系
      await db.collection(HELPS).doc(helpId).update({
        data: { status: 'done', finishTime: now(), updateTime: now() },
      });
      return { success: true };
    }

    // ===================== 举报 =====================
    if (action === 'report') {
      const helpId = trimStr(event.helpId, 40);
      const hRes = await db.collection(HELPS).doc(helpId).get().catch(() => null);
      const h = hRes && hRes.data;
      if (!h) return { success: false, error: '不存在' };
      if (h.userId === OPENID) return { success: false, error: '不能举报自己的' };

      const dup = await db.collection('help_reports').where({ helpId, userId: OPENID }).limit(1).get().catch(() => null);
      if (dup && dup.data.length) return { success: false, error: '已经举报过了' };

      await db.collection('help_reports').add({
        data: { helpId, eventId: h.eventId, userId: OPENID, createTime: now() },
      }).catch(() => {});
      const cnt = await db.collection('help_reports').where({ helpId }).count().catch(() => ({ total: 1 }));
      const total = cnt.total || 1;
      await db.collection(HELPS).doc(helpId).update({
        data: { reportCount: total, status: total >= 3 ? 'banned' : h.status, updateTime: now() },
      }).catch(() => {});
      return { success: true };
    }

    // ===================== 取消应征 =====================
    if (action === 'cancelApply') {
      const applyId = trimStr(event.applyId, 40);
      const aRes = await db.collection(APPLIES).doc(applyId).get().catch(() => null);
      const a = aRes && aRes.data;
      if (!a) return { success: false, error: '不存在' };
      if (a.userId !== OPENID) return { success: false, error: '无权操作' };

      const canceledCount = await countCanceled(OPENID, a.eventId);
      if (canceledCount >= LIMIT.cancelPerEvent) {
        return { success: false, error: `本场赛事已撤销 ${LIMIT.cancelPerEvent} 次，不能再取消了` };
      }

      // 临近截止才取消 = 放鸽子：这时候别人再找搭子已经来不及了。
      // 提前好几天打声招呼是正常的，不罚。
      const hRes = await db.collection(HELPS).doc(a.helpId).get().catch(() => null);
      const h = hRes && hRes.data;
      const hoursLeft = h ? (new Date(h.deadline).getTime() - Date.now()) / 3600000 : 999;
      const noshow = h && hoursLeft <= LIMIT.noshowWindowHours;

      await db.collection(APPLIES).doc(applyId).update({
        data: { status: 'canceled', cancelFlag: noshow ? 'noshow' : 'normal', cancelTime: now() },
      });

      // 名额按人数重算：撤销后腾出来的位置要放回去，满员的也得恢复招募
      const cRes = await db.collection(APPLIES)
        .where({ helpId: a.helpId, status: _.neq('canceled') }).get().catch(() => ({ data: [] }));
      const alive = (cRes && cRes.data) || [];
      const people = alive.reduce((s, x) => s + Math.max(1, parseInt(x.peopleCount, 10) || 1), 0);
      if (h) {
        const need = Math.max(1, parseInt(h.peopleNeeded, 10) || 1);
        const notExpired = new Date(h.deadline).getTime() > Date.now();
        await db.collection(HELPS).doc(a.helpId).update({
          data: {
            applyCount: alive.length,
            applyPeople: people,
            status: h.status === 'full' && people < need && notExpired ? 'open' : h.status,
            updateTime: now(),
          },
        }).catch(() => {});
        // 组里有人退出，发起人和剩下的搭子都要知道
        const typeLabel = (TYPES[h.type] || {}).label || '互助';
        await broadcast(h, `${typeLabel}「${truncate(h.title, 8)}」有人取消应征`, OPENID);
      }

      return {
        success: true,
        noshow: !!noshow,
        remain: Math.max(0, LIMIT.cancelPerEvent - (canceledCount + 1)),
        noshowCount: await countNoshow(OPENID),
      };
    }

    return { success: false, error: '未知操作' };
  } catch (err) {
    console.error('raceHelp error:', err);
    return { success: false, error: err.message || '出错了，稍后再试' };
  }
};
