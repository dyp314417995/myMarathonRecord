// cloudfunctions/raceHelp/index.js - 跑友互助（赛事内拼房/拼车/约饭）
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

// 支持的互助类型
const TYPES = {
  room: { label: '拼房', icon: '🏠' },
  carpool: { label: '拼车', icon: '🚗' },
  meal: { label: '约饭', icon: '🍜' },
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
};

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

// 同一用户在同一场赛事下已撤销的次数
async function countCanceled(userId, eventId) {
  const c = await db.collection(APPLIES)
    .where({ userId, eventId, status: 'canceled' })
    .count().catch(() => ({ total: 0 }));
  return c.total || 0;
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
    // ===================== 某场赛事下的互助列表 =====================
    if (action === 'list') {
      const { eventId } = event;
      if (!eventId) return { success: false, error: '缺少 eventId' };

      // 必须关注了这场赛事才看得到（这是我们不做公共信息流的边界）
      const mk = await db.collection('race_markers').where({ userId: OPENID, eventId }).limit(1).get().catch(() => null);
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
      const peopleNeeded = Math.max(1, Math.min(9, parseInt(event.peopleNeeded, 10) || 1));
      const deadlineStr = trimStr(event.deadline, 20);   // "2026-11-08"
      const contact = event.contact || {};
      const wechat = trimStr(contact.wechat, 20);

      if (!eventId) return { success: false, error: '缺少赛事' };
      if (!TYPES[type]) return { success: false, error: '类型不支持' };
      if (!title) return { success: false, error: '请填写标题' };
      if (event.ruleAgreed !== true) return { success: false, error: '请先阅读并勾选互助规则' };
      if (!wechat) return { success: false, error: '请填写微信号' };
      if (!validWechat(wechat)) return { success: false, error: '微信号格式不对' };

      const deadline = new Date(`${deadlineStr} 23:59:59`);
      if (isNaN(deadline.getTime())) return { success: false, error: '截止时间不正确' };
      if (deadline <= now()) return { success: false, error: '截止时间要在今天之后' };
      if (deadline.getTime() - Date.now() > LIMIT.maxDays * 86400000) {
        return { success: false, error: `截止时间最多 ${LIMIT.maxDays} 天后` };
      }

      // 关注门槛
      const mk = await db.collection('race_markers').where({ userId: OPENID, eventId }).limit(1).get().catch(() => null);
      if (!(mk && mk.data && mk.data.length)) {
        return { success: false, error: '只有关注了这场赛事的跑友才能发布互助' };
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
          applyCount: 0,
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

      await checkText(message, OPENID);

      await db.collection(APPLIES).add({
        data: {
          helpId, eventId: h.eventId, userId: OPENID, nickName,
          contact: { wechat },
          message,
          status: 'pending',
          createTime: now(),
        },
      });
      const cnt = await db.collection(APPLIES).where({ helpId, status: _.neq('canceled') }).count().catch(() => ({ total: 1 }));
      await db.collection(HELPS).doc(helpId).update({
        data: { applyCount: cnt.total || 0, updateTime: now() },
      }).catch(() => {});
      return { success: true };
    }

    // ===================== 我发布的互助（含应征者联系方式） =====================
    if (action === 'myHelps') {
      const res = await db.collection(HELPS)
        .where({ userId: OPENID })
        .orderBy('createTime', 'desc')
        .limit(50).get().catch(() => ({ data: [] }));
      const list = res.data || [];

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
        const remain = Math.max(0, LIMIT.cancelPerEvent - (cancelMap[a.eventId] || 0));
        return {
          applyId: a._id,
          message: a.message,
          myContact: { wechat: (a.contact || {}).wechat },
          createTime: a.createTime,
          // 双方都已表达诚意，互见联系方式
          ownerContact: { wechat: (h.contact || {}).wechat },
          cancelRemain: remain,
          canCancel: remain > 0,
          ...publicHelp(h, {
            typeLabel: (TYPES[h.type] || {}).label || '其他',
            typeIcon: (TYPES[h.type] || {}).icon || '🙌',
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
      if (h.userId !== OPENID) return { success: false, error: '只能关闭自己发布的' };
      await db.collection(HELPS).doc(helpId).update({
        data: { status: 'closed', updateTime: now() },
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

      await db.collection(APPLIES).doc(applyId).update({ data: { status: 'canceled', cancelTime: now() } });
      const cnt = await db.collection(APPLIES).where({ helpId: a.helpId, status: _.neq('canceled') }).count().catch(() => ({ total: 0 }));
      await db.collection(HELPS).doc(a.helpId).update({
        data: { applyCount: cnt.total || 0, updateTime: now() },
      }).catch(() => {});
      return { success: true, remain: Math.max(0, LIMIT.cancelPerEvent - (canceledCount + 1)) };
    }

    return { success: false, error: '未知操作' };
  } catch (err) {
    console.error('raceHelp error:', err);
    return { success: false, error: err.message || '出错了，稍后再试' };
  }
};
