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

// 限制。刻意只留输入本身的边界，不限制发起/取消的次数，也不设惩罚：
// 跑友约伴临时变卦是常事，规矩越多越没人敢发；真有人乱来，靠举报兜底就够了。
const LIMIT = {
  title: 20,
  desc: 200,
  costNote: 30,
  message: 50,
  maxDays: 90,        // 截止时间最多 90 天后
  maxPeople: 9,       // 单条互助最多招募人数
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
// 关键：互助记录里的 userId 存的就是 OPENID（发布/应征时写的是 OPENID），
// 拿它去 users.doc() 查必然落空 → 返回空 → notify 直接放弃，
// 结果就是「有人应征」「有人退出」这些通知悄悄发不出去。openid 直接用，不必再查。
const OPENID_RE = /^o[\w-]{20,}$/;

async function getOpenid(userId) {
  if (!userId) return '';
  const s = String(userId);
  if (OPENID_RE.test(s)) return s;
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
        page: page || '/pages/tools/calendar/index',
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

// 互助里只存了 eventId。小工具的聚合页要按赛事分组，得知道赛事叫什么、哪天跑，
// 所以一次批量补齐，别让前端拿着 eventId 一场一场去查（那是 N 次请求）。
async function eventBrief(ids) {
  const uniq = Array.from(new Set((ids || []).filter(Boolean)));
  if (!uniq.length) return {};
  const r = await db.collection('race_events')
    .where({ _id: _.in(uniq) })
    .field({ name: 1, date: 1, city: 1 })
    .limit(100).get().catch(() => ({ data: [] }));
  const map = {};
  ((r && r.data) || []).forEach((e) => { map[e._id] = e; });
  return map;
}

function eventExtra(map, eventId) {
  const e = (map && map[eventId]) || {};
  return {
    eventName: e.name || '',
    eventDate: e.date || null,
    eventCity: e.city || '',
  };
}

// 只取「哪一天」，用于判断赛事是不是已经跑完了。
// 云函数跑在 UTC 上，直接 toISOString 会让北京时间早上 8 点前的比赛算成前一天，
// 所以统一加 8 小时再取日期。
function dayKey(v) {
  if (!v) return '';
  const d = (v instanceof Date) ? v : new Date(v);
  if (isNaN(d.getTime())) return '';
  return new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

// 四种对外状态：招募中 / 已截止 / 已完成 / 已取消
// 「已截止」是算出来的、不落库：到点还开着就是已截止，省得靠定时任务去改一堆记录。
// 兼容历史数据：早先取消写的是 status='closed'，一并认。
const STATE_LABEL = { open: '招募中', expired: '已截止', done: '已完成', canceled: '已取消', banned: '已下架' };

function helpState(h) {
  const s = h && h.status;
  // 'full' 是旧数据里「招满」的写法，跟 done 同义；
  // 不认的话它会掉进下面的时间判断，满员的又会冒出来被人接着应征
  if (s === 'done' || s === 'full') return 'done';
  if (s === 'canceled' || s === 'closed') return 'canceled';
  if (s === 'banned') return 'banned';
  const t = new Date(h && h.deadline).getTime();
  if (!t || t <= Date.now()) return 'expired';
  return 'open';
}

// 统一给前端算好的字段，别让各个页面自己推算状态
function decorateHelp(h, extra = {}) {
  const state = helpState(h);
  const need = Math.max(1, parseInt(h.peopleNeeded, 10) || 1);
  const applied = parseInt(h.applyPeople, 10) || 0;
  const ms = new Date(h.deadline).getTime() - Date.now();
  return publicHelp(h, {
    typeLabel: (TYPES[h.type] || {}).label || '其他',
    typeIcon: (TYPES[h.type] || {}).icon || '🙌',
    state,
    stateLabel: STATE_LABEL[state] || '',
    expired: state === 'expired',
    isDone: state === 'done',
    isCanceled: state === 'canceled',
    applyPeople: applied,
    remainPeople: Math.max(0, need - applied),
    daysLeft: Math.max(0, Math.ceil(ms / 86400000)),
    hoursLeft: Math.max(0, Math.ceil(ms / 3600000)),
    ...extra,
  });
}

// 发布表单的取字段 + 校验：create 和 update 共用一套，免得两边规矩各写各的
function parseHelpForm(event) {
  return {
    eventId: trimStr(event.eventId, 40),
    type: trimStr(event.type, 10),
    title: trimStr(event.title, LIMIT.title),
    desc: trimStr(event.desc, LIMIT.desc),
    costNote: trimStr(event.costNote, LIMIT.costNote),
    peopleNeeded: Math.max(1, Math.min(LIMIT.maxPeople, parseInt(event.peopleNeeded, 10) || 1)),
    wechat: trimStr((event.contact || {}).wechat, 20),
    deadline: parseDeadline(event.deadline),
    ruleAgreed: event.ruleAgreed === true,
  };
}

function validateHelpForm(f) {
  if (!f.eventId) return '缺少赛事';
  if (!TYPES[f.type]) return '类型不支持';
  if (f.type === 'carpool') return '拼车互助已下线';   // 入口已撤，服务端兜底拦新建
  if (!f.title) return '请填写标题';
  if (!f.ruleAgreed) return '请先阅读并勾选互助规则';
  if (!f.wechat) return '请填写微信号';
  if (!validWechat(f.wechat)) return '微信号格式不对';
  if (!f.deadline) return '截止时间不正确';
  if (f.deadline <= now()) return '截止时间要在今天之后';
  if (f.deadline.getTime() - Date.now() > LIMIT.maxDays * 86400000) {
    return `截止时间最多 ${LIMIT.maxDays} 天后`;
  }
  const bad = hasBlockedWord(`${f.title}${f.desc}${f.costNote}`);
  if (bad) return `内容含有不允许的信息（${bad}）`;
  return '';
}

exports.main = async (event = {}) => {
  const action = event.action;

  const { OPENID } = cloud.getWXContext();
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

      // 一场赛事一个池子：只取这场，已删除的不再出现
      const res = await db.collection(HELPS)
        .where({ eventId })
        .orderBy('createTime', 'desc')
        .limit(50).get().catch(() => ({ data: [] }));
      const rows = (res.data || [])
        .filter(h => !h.deleted)
        .filter(h => h.type !== 'carpool')   // 拼车互助已下线：历史数据也不再展示
        .filter(h => (parseInt(h.reportCount, 10) || 0) < 3);

      // 认「在不在组内」：发起人，或者应征过（后来退出的也算——他得看得到后面被取消/完成）
      const ids = rows.map(h => h._id);
      const mineRes = ids.length
        ? await db.collection(APPLIES).where({ helpId: _.in(ids), userId: OPENID }).limit(100).get().catch(() => null)
        : null;
      const joined = new Set(((mineRes && mineRes.data) || []).map(a => a.helpId));

      const list = rows.map((h) => {
        const member = h.userId === OPENID || joined.has(h._id);
        const state = helpState(h);
        // 不在组内的，只看得到「招募中」——截止、完成、取消都是组内的事
        if (!member && state !== 'open') return null;
        return decorateHelp(h, { isMine: h.userId === OPENID, isMember: member });
      }).filter(Boolean);

      return { success: true, followed: true, list };
    }

    // ===================== 发布互助 =====================
    if (action === 'create') {
      const f = parseHelpForm(event);
      const bad = validateHelpForm(f);
      if (bad) return { success: false, error: bad };

      // 关注门槛。别拿 OPENID 直接去比：关注记录 race_markers 里存的是 users 内部 _id，
      // 用 openid 查永远落空，于是每个关注过的跑友都在点提交这一步被判成「未关注」。
      const who = await resolveUserIds(OPENID);
      const mk = await db.collection('race_markers').where({ userId: who, eventId: f.eventId }).limit(1).get().catch(() => null);
      if (!(mk && mk.data && mk.data.length)) {
        return { success: false, error: '只有关注了这场赛事的跑友才能发布互助' };
      }

      await checkText(`${f.title} ${f.desc} ${f.costNote}`, OPENID);

      // 取昵称头像快照
      let nickName = '跑友', avatarUrl = '';
      const uRes = await db.collection('users').where({ _openid: OPENID }).limit(1).get().catch(() => null);
      if (uRes && uRes.data && uRes.data[0]) {
        nickName = uRes.data[0].nickName || '跑友';
        avatarUrl = uRes.data[0].avatarUrl || '';
      }

      const addRes = await db.collection(HELPS).add({
        data: {
          eventId: f.eventId, userId: OPENID, nickName, avatarUrl,
          type: f.type, title: f.title, desc: f.desc, costNote: f.costNote,
          peopleNeeded: f.peopleNeeded,
          deadline: f.deadline,
          contact: { wechat: f.wechat },
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

    // ===================== 编辑并重新发起 =====================
    // 只对「已取消」「已截止」开放：这两种都已经不能应征了，改完重新挂上去，还是同一条记录。
    // 已完成的不给改——那是已经约成的事，要重新组队就再发一条。
    if (action === 'update') {
      const helpId = trimStr(event.helpId, 40);
      if (!helpId) return { success: false, error: '缺少参数' };
      const hRes = await db.collection(HELPS).doc(helpId).get().catch(() => null);
      const h = hRes && hRes.data;
      if (!h || h.deleted) return { success: false, error: '这条互助不存在' };
      if (h.userId !== OPENID) return { success: false, error: '只能编辑自己发布的' };

      const st = helpState(h);
      if (st !== 'canceled' && st !== 'expired') {
        return {
          success: false,
          error: st === 'done' ? '已完成的不能编辑，需要的话重新发布一条' : '进行中的互助不能编辑，请先取消',
        };
      }

      const f = parseHelpForm(event);
      if (!f.eventId) f.eventId = h.eventId;
      const bad = validateHelpForm(f);
      if (bad) return { success: false, error: bad };

      await checkText(`${f.title} ${f.desc} ${f.costNote}`, OPENID);

      // 名额按「还活着」的应征重算：被取消作废的那批不能算进来，
      // 否则重新发起时人还没来就已经显示满员了
      const aliveRes = await db.collection(APPLIES)
        .where({ helpId, status: _.neq('canceled') }).get().catch(() => ({ data: [] }));
      const alive = (aliveRes && aliveRes.data) || [];
      const people = alive.reduce((s, a) => s + Math.max(1, parseInt(a.peopleCount, 10) || 1), 0);

      // 重新挂回招募中：清掉上一次的收尾痕迹
      await db.collection(HELPS).doc(helpId).update({
        data: {
          type: f.type, title: f.title, desc: f.desc, costNote: f.costNote,
          peopleNeeded: f.peopleNeeded,
          deadline: f.deadline,
          contact: { wechat: f.wechat },
          applyCount: alive.length,
          applyPeople: people,
          status: 'open',
          doneReason: '',
          cancelTime: null,
          updateTime: now(),
        },
      });
      return { success: true, id: helpId };
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
      if (!h || h.deleted) return { success: false, error: '这条互助不存在' };
      if (h.userId === OPENID) return { success: false, error: '不能应征自己发布的互助' };

      // 只有「招募中」能被应征：已截止 / 已完成 / 已取消 都不行
      const st = helpState(h);
      if (st !== 'open') {
        return {
          success: false,
          error: st === 'expired' ? '这条互助已截止' : (st === 'done' ? '这条互助已完成' : '这条互助已取消'),
        };
      }

      // 同上：应征也要认这条换算后的身份，不能直接用 OPENID 比对关注记录
      const whoApply = await resolveUserIds(OPENID);
      const mk = await db.collection('race_markers').where({ userId: whoApply, eventId: h.eventId }).limit(1).get().catch(() => null);
      if (!(mk && mk.data && mk.data.length)) {
        return { success: false, error: '请先关注这场赛事' };
      }

      // 已取消的不算重复，允许重新应征
      const dup = await db.collection(APPLIES).where({ helpId, userId: OPENID, status: _.neq('canceled') }).limit(1).get().catch(() => null);
      if (dup && dup.data.length) return { success: false, error: '已经应征过了' };



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
      // 人满自动完成：这是「已完成」的两种来源之一（另一种是发起人提前结束）
      const full = people >= need;
      const upd = { applyCount: alive.length, applyPeople: people, updateTime: now() };
      if (full) Object.assign(upd, { status: 'done', doneReason: 'full', doneTime: now() });
      await db.collection(HELPS).doc(helpId).update({ data: upd }).catch(() => {});

      // 组里广播。订阅消息是一次性的，收不到也不打紧——「我发布的」里照样看得到应征者
      const typeLabel = (TYPES[h.type] || {}).label || '互助';
      await broadcast(h, `${typeLabel}「${truncate(h.title, 8)}」有人应征了`, OPENID);
      if (full) {
        await broadcast(h, `${typeLabel}「${truncate(h.title, 8)}」已约满`, OPENID);
      }

      return { success: true, full, remain: Math.max(0, remain - peopleCount) };
    }

    // ===================== 我关注的赛事（发布时先选一场） =====================
    // 聚合页不在某场赛事的上下文里，发布前必须先知道「发到哪场」。
    // 这里只回精简字段，够选就行，别把整场赛事（timeline/poster）都塞过来
    if (action === 'myEvents') {
      const who = await resolveUserIds(OPENID);
      const mkRes = await db.collection('race_markers')
        .where({ userId: who })
        .orderBy('createTime', 'desc')
        .limit(50).get().catch(() => ({ data: [] }));
      const ids = Array.from(new Set(((mkRes && mkRes.data) || []).map(m => m.eventId).filter(Boolean)));
      const map = await eventBrief(ids);
      // 只保留库里还在的赛事。赛事被删或重建换了 id 之后，老的关注记录会变成孤儿，
      // 列出来只能显示「待更新」，点了也发不出去（赛事根本不存在）——不如不显示
      const list = ids.filter(id => map[id]).map((id) => {
        const e = map[id];
        return { eventId: id, name: e.name || '赛事信息待更新', date: e.date || null, city: e.city || '' };
      });
      // 已经跑完的赛事不再列出来：跑完了还发拼房拼车，没有意义。
      // 当天要留着——回程拼车正是比赛日当天的事，所以比较用 >=
      const today = dayKey(new Date());
      const usable = list.filter(x => !x.date || dayKey(x.date) >= today);

      // 离得近的排前面，没日期的沉底——发布时多数人找的就是最近那场
      usable.sort((x, y) => {
        const tx = new Date(x.date || 8.64e15).getTime();
        const ty = new Date(y.date || 8.64e15).getTime();
        return tx - ty;
      });
      return { success: true, list: usable };
    }

    // ===================== 我发布的互助（含应征者联系方式） =====================
    if (action === 'myHelps') {
      const res = await db.collection(HELPS)
        .where({ userId: OPENID })
        .orderBy('createTime', 'desc')
        .limit(50).get().catch(() => ({ data: [] }));
        // 删除过的不再露面；其余四种状态都留着，让人看得见这条互助的来龙去脉
        const list = (res.data || []).filter(h => !h.deleted && h.type !== 'carpool');
        const evMap = await eventBrief(list.map(h => h.eventId));

        const helps = await Promise.all(list.map(async (h) => {
        const aRes = await db.collection(APPLIES)
          .where({ helpId: h._id, status: _.neq('canceled') })
          .orderBy('createTime', 'desc').limit(30).get().catch(() => ({ data: [] }));
        // 只有发布者自己能看应征者的联系方式
        const applicants = (aRes.data || []).map(a => ({
          userId: a.userId, nickName: a.nickName, message: a.message,
          contact: { wechat: (a.contact || {}).wechat }, createTime: a.createTime,
        }));
        // myWechat 只回给发起人自己：编辑表单要回填他原来填的微信号
        return decorateHelp(h, {
          applicants,
          isMine: true,
          isMember: true,
          myWechat: (h.contact || {}).wechat || '',
          ...eventExtra(evMap, h.eventId),
        });
      }));
      return { success: true, list: helps };
    }

    // ===================== 我应征的（已应征 → 可见发布者联系方式） =====================
    if (action === 'myApplies') {
      const aRes = await db.collection(APPLIES)
        .where({ userId: OPENID })
        .orderBy('createTime', 'desc').limit(50).get().catch(() => ({ data: [] }));
      // 自己主动退的不再占位置；发起人取消的那种要留着，得让人知道是被谁取消的
      const applies = (aRes.data || []).filter(a => !a.deleted && (a.status !== 'canceled' || a.cancelFlag === 'owner-canceled'));
      const evMap = await eventBrief(applies.map(a => a.eventId));

      const list = await Promise.all(applies.map(async (a) => {
        const hRes = await db.collection(HELPS).doc(a.helpId).get().catch(() => null);
        const h = hRes && hRes.data;
        if (!h || h.deleted || h.type === 'carpool') return null;   // 拼车互助已下线
        const state = helpState(h);
        return {
          applyId: a._id,
          message: a.message,
          peopleCount: Math.max(1, parseInt(a.peopleCount, 10) || 1),
          myContact: { wechat: (a.contact || {}).wechat },
          createTime: a.createTime,
          // 双方都已表达诚意，互见联系方式
          ownerContact: { wechat: (h.contact || {}).wechat },
          applyCanceled: a.status === 'canceled',
          // 谁都能退：招募中、已截止，甚至已经完成的，人都可以说不去了——
          // 锁住名单只会让他线下默默放鸽子，那才是互助最怕的事。
          // 只有发起人已经取消的那条没什么可退的
          canCancel: a.status !== 'canceled' && state !== 'canceled',
          // 删除只给已经结束的：要么这条被取消了，要么自己已经退出去了。
          // 已完成的不能直接删，否则等于用抹掉记录来掩盖退出，发起人那边人还在
          canDelete: state === 'canceled' || a.status === 'canceled',
          ...decorateHelp(h, eventExtra(evMap, h.eventId)),
        };
      }));
      return { success: true, list: list.filter(Boolean) };
    }

    // ===================== 取消发布（发起人） =====================
    // 招募中、已截止都能取消；有人应征就必须通知到位，无人应征就静静撤掉
    if (action === 'cancel' || action === 'close') {
      const helpId = trimStr(event.helpId, 40);
      const hRes = await db.collection(HELPS).doc(helpId).get().catch(() => null);
      const h = hRes && hRes.data;
      if (!h || h.deleted) return { success: false, error: '不存在' };
      if (h.userId !== OPENID) return { success: false, error: '只能取消自己发布的' };
      const st = helpState(h);
      if (st === 'canceled') return { success: false, error: '已经取消过了' };
      if (st === 'done') return { success: false, error: '这条已经完成了，不能再取消' };

      await db.collection(HELPS).doc(helpId).update({
        data: { status: 'canceled', cancelTime: now(), updateTime: now() },
      });

      // 已经应征的人全部作废，并挨个通知到位
      const aRes = await db.collection(APPLIES)
        .where({ helpId, status: _.neq('canceled') }).limit(50).get().catch(() => ({ data: [] }));
      const list = (aRes && aRes.data) || [];
      const typeLabel = (TYPES[h.type] || {}).label || '互助';
      const content = `${typeLabel}「${truncate(h.title, 8)}」发起人已取消`;
      // 顺序很重要：先把消息送到，再作废应征记录。
      // 作废之后他们就不算组员了，广播会找不到人。
      // 没人应征就别打扰人了——这种情况本来也不需要通知谁
      const notified = list.length ? await broadcast(h, content, OPENID) : 0;
      await Promise.all(list.map(a => db.collection(APPLIES).doc(a._id).update({
        data: { status: 'canceled', cancelFlag: 'owner-canceled', cancelTime: now() },
      }).catch(() => {})));

      return { success: true, applicantCount: list.length, notified };
    }

    // ===================== 完成（发起人） =====================
    // 两个入口：招募中提前收尾、已截止后确认组队成功——人够没够都行，发起人自己判断
    if (action === 'finish') {
      const helpId = trimStr(event.helpId, 40);
      const hRes = await db.collection(HELPS).doc(helpId).get().catch(() => null);
      const h = hRes && hRes.data;
      if (!h || h.deleted) return { success: false, error: '不存在' };
      if (h.userId !== OPENID) return { success: false, error: '只能标记自己发布的' };
      const st = helpState(h);
      if (st === 'done') return { success: false, error: '已经完成了' };
      if (st === 'canceled') return { success: false, error: '这条已经取消了' };

      await db.collection(HELPS).doc(helpId).update({
        data: { status: 'done', doneReason: 'owner', doneTime: now(), updateTime: now() },
      });

      // 组里其他人也该知道这事有结果了
      const typeLabel = (TYPES[h.type] || {}).label || '互助';
      await broadcast(h, `${typeLabel}「${truncate(h.title, 8)}」发起人已确认完成`, OPENID).catch(() => 0);
      return { success: true };
    }

    // ===================== 删除（发起人） =====================
    // 只对已完成 / 已取消开放：这两种都是终态，删掉只是让它从列表里消失，记录仍留在库里可追溯
    if (action === 'delete') {
      const helpId = trimStr(event.helpId, 40);
      const hRes = await db.collection(HELPS).doc(helpId).get().catch(() => null);
      const h = hRes && hRes.data;
      if (!h || h.deleted) return { success: false, error: '不存在' };
      if (h.userId !== OPENID) return { success: false, error: '只能删除自己发布的' };
      const st = helpState(h);
      if (st !== 'done' && st !== 'canceled') {
        return { success: false, error: '只有已完成或已取消的才能删除' };
      }

      await db.collection(HELPS).doc(helpId).update({
        data: { deleted: true, deletedTime: now(), updateTime: now() },
      });
      return { success: true };
    }

    // ===================== 应征者删除（只影响他自己的列表） =====================
    if (action === 'deleteApply') {
      const applyId = trimStr(event.applyId, 40);
      const aRes = await db.collection(APPLIES).doc(applyId).get().catch(() => null);
      const a = aRes && aRes.data;
      if (!a) return { success: false, error: '不存在' };
      if (a.userId !== OPENID) return { success: false, error: '无权操作' };

      const hRes = await db.collection(HELPS).doc(a.helpId).get().catch(() => null);
      const h = hRes && hRes.data;
      const st = h ? helpState(h) : 'done';
      // 还在招/刚截止的不能删，得先取消应征，免得把进行中的事从眼前抹掉
      if (a.status !== 'canceled' && st !== 'done' && st !== 'canceled') {
        return { success: false, error: '还在进行的互助不能删除，可以先取消应征' };
      }

      await db.collection(APPLIES).doc(applyId).update({ data: { deleted: true } });
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
      if (a.status === 'canceled') return { success: false, error: '已经取消过了' };

      const hRes = await db.collection(HELPS).doc(a.helpId).get().catch(() => null);
      const h = hRes && hRes.data;
      const st = h ? helpState(h) : 'canceled';
      if (st === 'canceled') return { success: false, error: '这条互助已被发起人取消' };

      await db.collection(APPLIES).doc(applyId).update({
        data: { status: 'canceled', cancelTime: now() },
      });

      // 名额按人数重算：退出去的位置要放回去，别人还能补位
      const cRes = await db.collection(APPLIES)
        .where({ helpId: a.helpId, status: _.neq('canceled') }).get().catch(() => ({ data: [] }));
      const alive = (cRes && cRes.data) || [];
      const people = alive.reduce((s, x) => s + Math.max(1, parseInt(x.peopleCount, 10) || 1), 0);
      let reopened = false;
      if (h) {
        const need = Math.max(1, parseInt(h.peopleNeeded, 10) || 1);
        const upd = { applyCount: alive.length, applyPeople: people, updateTime: now() };
        // 招满自动完成的那条，人走了这个「满」就不成立了，退回招募中接着招。
        // 已经过了截止时间的话，读的时候自然算成「已截止」，不用在这儿单独写状态。
        // 发起人自己确认完成的（doneReason=owner）不推翻他的决定，只更新人数。
        const wasFull = h.doneReason === 'full' || h.status === 'full';
        if (st === 'done' && wasFull && people < need) {
          Object.assign(upd, { status: 'open', doneReason: '', doneTime: null });
          reopened = true;
        }
        await db.collection(HELPS).doc(a.helpId).update({ data: upd }).catch(() => {});

        // 组里有人退出，发起人和剩下的搭子都要知道——包括「人又不够了」这件事
        const typeLabel = (TYPES[h.type] || {}).label || '互助';
        const tail = reopened ? `有人退出，现在 ${people}/${need} 人，重新开放招募` : `有人退出，现在 ${people}/${need} 人`;
        await broadcast(h, `${typeLabel}「${truncate(h.title, 8)}」${tail}`, OPENID).catch(() => 0);
      }

      return { success: true, reopened };
    }

    return { success: false, error: '未知操作' };
  } catch (err) {
    console.error('raceHelp error:', err);
    return { success: false, error: err.message || '出错了，稍后再试' };
  }
};
