// cloudfunctions/raceWish - 赛事心愿单
//
// 用户想跑的赛事没被收录时，填一个心愿（就写赛事名），提交后通知超管去补录。
//
// 三种调用：
//   1. { action:'add', content, userId }  -> 提交心愿，落库 + 推订阅消息给超管
//   2. { action:'list', status }          -> 管理端查心愿列表（默认 pending）
//   3. { action:'mine', userId }          -> 查我自己提交过的心愿
//
// 说明：订阅消息受微信限制（用户没授权过该模板就收不到），所以心愿一定落库，
//       管理后台可以随时查看，不完全依赖推送。
const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d5gy0iuiba5f9300f' });
const db = cloud.database();
const _ = db.command;

// 复用日历里「关注赛事」已授权过的通用模板（date1 / thing2 / time3）
const TEMPLATE_ID = 'xepY9QmUT4YPXUt7mLhQrtlVBcN01eGkk-NqH0Av5Ew';
const COLL = 'race_wishes';

const truncate = (s, n) => {
  if (!s) return '';
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

function todayStr() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// 首次写入前集合可能不存在（-502005）：自动建表后重试一次
async function addWish(data) {
  try {
    return await db.collection(COLL).add({ data });
  } catch (e) {
    const code = String((e && e.errCode) || '');
    const msg = String((e && (e.errMsg || e.message)) || '');
    if (code === '-502005' || /not exist/i.test(msg) || /collection.*not/i.test(msg)) {
      try { await db.createCollection(COLL); } catch (_) { /* 已存在 */ }
      return await db.collection(COLL).add({ data });
    }
    throw e;
  }
}

// 通知超管：users 表里 role=super_admin 的人
async function notifySuperAdmins(content, nickName) {
  const ds = todayStr();
  const res = await db.collection('users')
    .where({ role: 'super_admin' })
    .limit(20).get().catch(() => null);
  const admins = (res && res.data) || [];
  if (!admins.length) return { adminCount: 0, sentCount: 0, errors: [{ reason: 'no_super_admin' }] };

  const data = {
    date1: { value: ds },
    thing2: { value: truncate(`心愿单：${content}`, 20) },
    time3: { value: ds },
  };

  let sentCount = 0;
  const errors = [];
  for (const u of admins) {
    if (!u.openid) { errors.push({ userId: u._id, reason: 'no_openid' }); continue; }
    try {
      const r = await cloud.callFunction({
        name: 'sendSubscribeMsg',
        data: {
          openid: u.openid,
          templateId: TEMPLATE_ID,
          page: '/pages/admin/races/races',
          data,
        },
      });
      if (r && r.result && r.result.ok) sentCount++;
      else errors.push({ userId: u._id, reason: 'send_fail' });
    } catch (err) {
      errors.push({ userId: u._id, reason: 'exception', err: err.message });
    }
  }
  return { adminCount: admins.length, sentCount, errors };
}

exports.main = async (event) => {
  const { action = 'add', content, userId, status = 'pending' } = event || {};

  // ---------- 提交心愿 ----------
  if (action === 'add') {
    const text = String(content || '').trim();
    if (!text) return { success: false, error: '请填写想跑的赛事' };
    if (text.length > 60) return { success: false, error: '写简明一点，60 字以内就行' };
    if (!userId) return { success: false, error: '请先登录' };

    // 同一人 7 天内重复提交同一赛事名，不再重复计数/推送
    const since = new Date(Date.now() - 7 * 86400000);
    const dup = await db.collection(COLL)
      .where({ userId, content: text, createTime: _.gte(since) })
      .limit(1).get().catch(() => null);
    if (dup && dup.data && dup.data[0]) {
      return { success: true, repeated: true, message: '这个心愿已经提过啦，超管会看到的' };
    }

    let nickName = '';
    const uRes = await db.collection('users').doc(userId).get().catch(() => null);
    if (uRes && uRes.data) nickName = uRes.data.nickName || uRes.data.nickname || '';

    const now = new Date();
    const addRes = await addWish({
      content: text,
      userId,
      nickName,
      status: 'pending',   // pending | done（超管已处理）
      createTime: now,
      updateTime: now,
    }).catch(() => null);
    if (!addRes) return { success: false, error: '提交失败，请重试' };

    const notify = await notifySuperAdmins(text, nickName).catch(() => ({ sentCount: 0, adminCount: 0 }));
    return { success: true, id: addRes._id, ...notify };
  }

  // ---------- 管理端列表 ----------
  if (action === 'list') {
    const where = status === 'all' ? {} : { status: status || 'pending' };
    const r = await db.collection(COLL)
      .where(where)
      .orderBy('createTime', 'desc')
      .limit(200).get().catch(() => null);
    const rows = (r && r.data) || [];
    return {
      success: true,
      list: rows.map(it => ({
        _id: it._id,
        content: it.content,
        nickName: it.nickName || '跑友',
        userId: it.userId,
        status: it.status || 'pending',
        createTime: it.createTime,
      })),
    };
  }

  // ---------- 我提交的 ----------
  if (action === 'mine') {
    if (!userId) return { success: true, list: [] };
    const r = await db.collection(COLL)
      .where({ userId })
      .orderBy('createTime', 'desc')
      .limit(50).get().catch(() => null);
    const rows = (r && r.data) || [];
    return { success: true, list: rows.map(it => ({ _id: it._id, content: it.content, status: it.status || 'pending', createTime: it.createTime })) };
  }

  // ---------- 超管标记已处理 ----------
  if (action === 'resolve') {
    const { id } = event;
    if (!id) return { success: false, error: '缺少 id' };
    await db.collection(COLL).doc(id).update({
      data: { status: 'done', updateTime: new Date() },
    }).catch(() => null);
    return { success: true };
  }

  return { success: false, error: '未知 action' };
};
