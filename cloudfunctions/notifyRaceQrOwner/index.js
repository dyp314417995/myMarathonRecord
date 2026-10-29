// cloudfunctions/notifyRaceQrOwner - 催建群 / 通知赛事负责人上传群二维码
//
// 三种调用：
//   1. { eventId, reporterId }                        -> 查进度（default action='status'）
//   2. { eventId, reporterId, reason, action:'remind' } -> 催办（按人去重，同一人 10 分钟冷却）
//   3. { eventIds: [...], action:'listReminds' }       -> 管理端批量查催办统计
//
// 进度规则：3 人是给管理员的参考值（满 3 人算 100%，不满管理员可以先不建）。
// 推送规则：只要有人催就推送负责人，不用等凑够 3 人。同一人 10 分钟内的重复催走冷却，不重复推送。
const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d5gy0iuiba5f9300f' });
const db = cloud.database();
const _ = db.command;

// 复用 sendSubscribeMsg 的订阅消息模板（date1 / thing2 / time3）
const TEMPLATE_ID = 'xepY9QmUT4YPXUt7mLhQrtlVBcN01eGkk-NqH0Av5Ew';

// ===== 二维码通知专用模板 =====
const QR_TEMPLATE_ID = 'mcDtCsiTEPabnEEWb317RnQT4K12zkoknB02GfQZHN4';
const QR_MSG_KEYS = { name: 'thing1', content: 'thing2', tip: 'thing3' };

// 催办达到该人数即视为「民意达标」，提醒管理员建群
const TARGET = 3;
// 同一人同一赛事的最小催办间隔（冷却只按人算：不同的人各自独立，互不影响）
const COOLDOWN_MS = 10 * 60 * 1000;
// 群二维码有效期（天），和前端 calcQrStatus 保持一致：微信个人群码 7 天失效
const QR_EXPIRE_DAYS = 7;

const REMIND_COLL = 'race_qr_remind';

// thing2 字段限制 20 字以内，做截断
const truncate = (s, n) => {
  if (!s) return '';
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

// ===== 省份名归一化 =====
const PROVINCE_ALIAS = {
  '北京市': '北京', '天津市': '天津', '上海市': '上海', '重庆市': '重庆',
  '内蒙古自治区': '内蒙古', '广西壮族自治区': '广西', '西藏自治区': '西藏',
  '宁夏回族自治区': '宁夏', '新疆维吾尔自治区': '新疆',
  '香港特别行政区': '香港', '澳门特别行政区': '澳门',
  '兵团': '新疆',
};
const PROVINCE_FULL = {
  '北京': '北京市', '天津': '天津市', '上海': '上海市', '重庆': '重庆市',
  '内蒙古': '内蒙古自治区', '广西': '广西壮族自治区', '西藏': '西藏自治区',
  '宁夏': '宁夏回族自治区', '新疆': '新疆维吾尔自治区',
  '香港': '香港特别行政区', '澳门': '澳门特别行政区', '台湾': '台湾省',
};
function canonProvince(name) {
  if (!name) return '';
  if (PROVINCE_ALIAS[name]) return PROVINCE_ALIAS[name];
  return String(name).replace(/(省|市)$/, '');
}
function provinceVariants(name) {
  const c = canonProvince(name);
  if (!c) return [];
  const v = [c];
  if (PROVINCE_FULL[c]) v.push(PROVINCE_FULL[c]);
  else v.push(c + '省');
  return v;
}

function getMsg(reason, raceName, count) {
  const today = new Date();
  const ds = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const name = truncate(raceName, 10);
  if (reason === 'expired') {
    return { date1: { value: ds }, thing2: { value: `${name}二维码过期啦` }, time3: { value: ds } };
  }
  return { date1: { value: ds }, thing2: { value: `${name}还没建群(${count}人催)` }, time3: { value: ds } };
}

function getQrMsg(reason, raceName, count) {
  const today = new Date();
  const ds = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const content = reason === 'expired'
    ? '群二维码已过期，请尽快更新'
    : `${count} 位跑友在等你建群`;
  return {
    [QR_MSG_KEYS.name]: { value: truncate(raceName, 20) },
    [QR_MSG_KEYS.content]: { value: truncate(content, 20) },
    [QR_MSG_KEYS.tip]: { value: ds },
  };
}

// 首次写入前集合可能不存在（-502005）：自动建表后重试一次
async function addRemind(data) {
  try {
    return await db.collection(REMIND_COLL).add({ data });
  } catch (e) {
    const code = String((e && e.errCode) || '');
    const msg = String((e && (e.errMsg || e.message)) || '');
    if (code === '-502005' || /not exist/i.test(msg) || /collection.*not/i.test(msg)) {
      try { await db.createCollection(REMIND_COLL); } catch (_) { /* 已存在 */ }
      return await db.collection(REMIND_COLL).add({ data });
    }
    throw e;
  }
}

// 读取某赛事的催办名单（按 userId 去重，保留最早一条）
async function loadRemindList(eventId) {
  const r = await db.collection(REMIND_COLL)
    .where({ eventId })
    .orderBy('createTime', 'asc')
    .limit(200).get().catch(() => null);
  const raw = (r && r.data) || [];
  const seen = {};
  const uniq = [];
  for (const it of raw) {
    const k = it.userId || it._id;
    if (seen[k]) continue;
    seen[k] = 1;
    uniq.push(it);
  }
  return uniq;
}

// 组装给前端的进度结构
function buildStatus(list, userId) {
  const count = list.length;
  const mine = userId ? list.find(it => it.userId === userId) : null;
  let cooldownLeft = 0;
  if (mine) {
    const t = new Date(mine.updateTime || mine.createTime).getTime();
    const left = COOLDOWN_MS - (Date.now() - t);
    if (left > 0) cooldownLeft = Math.ceil(left / 1000);
  }
  return {
    count,
    target: TARGET,
    percent: Math.min(100, Math.round((count / TARGET) * 100)),
    done: count >= TARGET,
    list: list.slice(0, 20).map(it => ({
      userId: it.userId,
      nickName: it.nickName || '跑友',
      avatarUrl: it.avatarUrl || '',
      time: it.createTime,
      isMe: !!userId && it.userId === userId,
    })),
    myReminded: !!mine,
    cooldownLeft,
  };
}

// 给负责该省的管理员推送订阅消息，返回 { sentCount, adminCount, errors }
async function pushToOwners(eventId, province, raceName, reason, count, reporterId) {
  const now = new Date();
  const adminsRes = await db.collection('admins').where({
    status: 'active',
    validFrom: _.lte(now),
    validTo: _.gte(now),
    provinces: _.in(provinceVariants(province)),
  }).get();
  let admins = adminsRes.data || [];

  // 没有匹配省份的管理员时，回退到负责全国（provinces 为空/缺失）的管理员
  if (admins.length === 0) {
    const allRes = await db.collection('admins').where({
      status: 'active',
      validFrom: _.lte(now),
      validTo: _.gte(now),
    }).get();
    admins = (allRes.data || []).filter(a => !Array.isArray(a.provinces) || a.provinces.length === 0);
  }
  if (admins.length === 0) return { sentCount: 0, adminCount: 0, errors: [{ reason: 'no_admin' }] };

  const userIds = admins.map(a => a.userId).filter(Boolean);
  const userRes = await db.collection('users').where({ _id: _.in(userIds) }).get();
  const userMap = {};
  (userRes.data || []).forEach(u => { userMap[u._id] = u; });

  const useQrTpl = !!QR_TEMPLATE_ID;
  const msgData = useQrTpl ? getQrMsg(reason, raceName, count) : getMsg(reason, raceName, count);
  let sentCount = 0;
  const errors = [];

  for (const a of admins) {
    const u = userMap[a.userId];
    if (!u || !u.openid) { errors.push({ adminId: a._id, reason: 'no_openid' }); continue; }
    try {
      const r = await cloud.callFunction({
        name: 'sendSubscribeMsg',
        data: {
          openid: u.openid,
          templateId: useQrTpl ? QR_TEMPLATE_ID : TEMPLATE_ID,
          page: `/pages/admin/races/races?editEventId=${eventId}`,
          data: msgData,
        },
      });
      if (r && r.result && r.result.ok) sentCount++;
      else errors.push({ adminId: a._id, reason: 'send_fail', err: (r && r.result && r.result.error) || 'unknown' });
    } catch (err) {
      errors.push({ adminId: a._id, reason: 'exception', err: err.message });
    }
  }
  return { sentCount, adminCount: admins.length, errors };
}

exports.main = async (event) => {
  const { action = 'status', eventId, reporterId, reason, eventIds } = event || {};

  // ---------- 管理端：批量查催办统计 ----------
  if (action === 'listReminds') {
    const ids = Array.isArray(eventIds) ? eventIds.slice(0, 50) : [];
    if (!ids.length) return { success: true, map: {} };
    const r = await db.collection(REMIND_COLL)
      .where({ eventId: _.in(ids) })
      .limit(500).get().catch(() => null);
    const rows = (r && r.data) || [];
    const map = {};
    for (const it of rows) {
      const k = it.eventId;
      if (!map[k]) map[k] = { count: 0, seen: {}, list: [] };
      const uid = it.userId || it._id;
      if (map[k].seen[uid]) continue;
      map[k].seen[uid] = 1;
      map[k].count++;
      map[k].list.push({
        userId: it.userId,
        nickName: it.nickName || '跑友',
        avatarUrl: it.avatarUrl || '',
        createTime: it.createTime,
      });
    }
    Object.keys(map).forEach(k => { delete map[k].seen; });
    return { success: true, map, target: TARGET };
  }

  if (!eventId) return { success: false, error: '缺少 eventId' };

  // ---------- 查进度 ----------
  if (action === 'status') {
    const list = await loadRemindList(eventId);
    return { success: true, ...buildStatus(list, reporterId) };
  }

  // ---------- 催办 ----------
  if (reason !== 'expired' && reason !== 'missing') {
    return { success: false, error: 'reason 必须为 expired 或 missing' };
  }
  if (!reporterId) return { success: false, error: '请先登录后再催办' };

  try {
    const raceRes = await db.collection('race_events').doc(eventId).get().catch(() => null);
    if (!raceRes || !raceRes.data) return { success: false, error: '赛事不存在' };
    const race = raceRes.data;
    const province = race.province;
    const raceName = race.name || '赛事';
    if (!province) return { success: false, error: '该赛事未设置举办省份，无法定位负责人' };

    // 已举办完成的赛事不再催办
    const startOfToday = (() => {
      const bj = new Date(Date.now() + 8 * 3600 * 1000);
      return new Date(Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate()) - 8 * 3600 * 1000);
    })();
    if (race.status === 'finished' || new Date(race.date).getTime() < startOfToday.getTime()) {
      return { success: true, skipped: true, message: '赛事已举办完成，无需建群' };
    }
    // 已经建群就不用催了 —— 但二维码过期（上传超过 7 天）的除外，
    // 那种情况要提醒管理员换新码，不能回「已建群」，否则点了没反应
    if (race.qrCode) {
      const days = race.qrCodeUpdatedAt
        ? (Date.now() - new Date(race.qrCodeUpdatedAt).getTime()) / 86400000
        : 0;
      const isExpired = days >= QR_EXPIRE_DAYS;
      if (!isExpired) {
        const list = await loadRemindList(eventId);
        return { success: true, alreadyCreated: true, message: '管理员已建群', ...buildStatus(list, reporterId) };
      }
      // 过期了：reason 必须是 expired，继续走下面的催办流程
      if (reason !== 'expired') {
        const list = await loadRemindList(eventId);
        return { success: true, alreadyCreated: true, message: '二维码已过期', ...buildStatus(list, reporterId) };
      }
    }

    // 取昵称/头像冗余存档，方便管理员直接认人拉群
    let nickName = '';
    let avatarUrl = '';
    const uRes = await db.collection('users').doc(reporterId).get().catch(() => null);
    if (uRes && uRes.data) {
      nickName = uRes.data.nickName || uRes.data.nickname || '';
      avatarUrl = uRes.data.avatarUrl || '';
    }

    const now = new Date();
    const existRes = await db.collection(REMIND_COLL)
      .where({ eventId, userId: reporterId }).limit(1).get().catch(() => null);
    const exist = existRes && existRes.data && existRes.data[0];

    let isNew = false;
    if (exist) {
      // 同一人 10 分钟内不允许再次提醒
      const lastAt = new Date(exist.updateTime || exist.createTime).getTime();
      const left = COOLDOWN_MS - (now.getTime() - lastAt);
      if (left > 0) {
        const list0 = await loadRemindList(eventId);
        return {
          success: true, cooldown: true, cooldownLeft: Math.ceil(left / 1000),
          message: `刚刚催过了，${Math.ceil(left / 60)} 分钟后再试`,
          ...buildStatus(list0, reporterId),
        };
      }
      // 超过 10 分钟：允许再催，但人数不重复算
      await db.collection(REMIND_COLL).doc(exist._id).update({
        data: {
          updateTime: now,
          reason,
          nickName: nickName || exist.nickName || '',
          avatarUrl: avatarUrl || exist.avatarUrl || '',
        },
      }).catch(() => {});
    } else {
      isNew = true;
      const addRes = await addRemind({
        eventId, userId: reporterId, nickName, avatarUrl, reason,
        createTime: now, updateTime: now,
      }).catch(() => null);
      if (!addRes) {
        // 并发下同一人可能已写入，兜底按已存在处理
        const again = await loadRemindList(eventId);
        return { success: true, ...buildStatus(again, reporterId) };
      }
    }

    const list = await loadRemindList(eventId);
    const status = buildStatus(list, reporterId);

    // 推送负责人：冷却只作用于「同一个人」，任何新用户催办都立刻推送
    //   同一人 10 分钟内重复催 → 走上面的 cooldown 分支，不推送、不累加人数
    //   不同的人 → 各自独立，都能催、都会推送（消息里带最新进度 N/3）
    let sentCount = 0;
    let adminCount = 0;
    let pushed = false;
    // 不用凑够 3 人才通知：只要有人催就发给负责人。
    // 3 人只是给管理员看的参考，不满 3 人他可以先不建。
    // 冷却分支在上面已 return，走到这里的都是有效催办。
    const p = await pushToOwners(eventId, province, raceName, reason, status.count, reporterId);
    sentCount = p.sentCount;
    adminCount = p.adminCount;
    pushed = true;
    // 记录推送日志（不参与去重，仅用于排查）
    await db.collection('qr_owner_notify_log').add({
      data: {
        eventId, raceName, province, reason,
        reporterId,
        createTime: new Date(),
        status: sentCount > 0 ? 'sent' : 'all_fail',
        sentCount,
        errors: p.errors,
        remindCount: status.count,
        milestone: status.done,
      },
    }).catch(() => {});

    return {
      success: true,
      isNew,
      repeat: !isNew,
      pushed,
      sentCount,
      adminCount,
      ...status,
    };
  } catch (err) {
    console.error('notifyRaceQrOwner error:', err);
    return { success: false, error: err.message };
  }
};
