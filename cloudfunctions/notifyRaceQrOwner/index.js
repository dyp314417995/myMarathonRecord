// cloudfunctions/notifyRaceQrOwner - 客户端触发：通知赛事负责人二维码过期/缺失
// 入参: { eventId, reporterId, reason: 'expired'|'missing' }
// 流程:
//   1. 读取赛事 (race_events) 拿到 province / name
//   2. 在 admins 集合查所有 status='active' 且 provinces 含此 province 的管理员
//   3. 在 users 集合拿这些管理员的 openid
//   4. 通过 sendSubscribeMsg 给每个管理员推送订阅消息
//   5. 写入 qr_owner_notify_log 集合（去重/防骚扰：同一赛事同一原因一天只通知一次）
const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d5gy0iuiba5f9300f' });
const db = cloud.database();
const _ = db.command;

// 复用 sendSubscribeMsg 的订阅消息模板（date1 / thing2 / time3）
const TEMPLATE_ID = 'xepY9QmUT4YPXUt7mLhQrtlVBcN01eGkk-NqH0Av5Ew';

// thing2 字段限制 20 字以内，做截断
const truncate = (s, n) => {
  if (!s) return '';
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

function getMsg(reason, raceName) {
  const today = new Date();
  const ds = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const name = truncate(raceName, 10); // 给 thing2 留 10 字给"过期/未上传"
  if (reason === 'expired') {
    return {
      date1: { value: ds },
      thing2: { value: `${name}二维码过期啦` },
      time3: { value: '请尽快更新' },
    };
  }
  // missing
  return {
    date1: { value: ds },
    thing2: { value: `${name}还没上传二维码` },
    time3: { value: '请尽快上传' },
  };
}

exports.main = async (event, context) => {
  const { eventId, reporterId, reason } = event || {};
  if (!eventId) return { success: false, error: '缺少 eventId' };
  if (!['expired', 'missing'].includes(reason)) return { success: false, error: 'reason 必须为 expired 或 missing' };

  try {
    // 0. 查赛事
    const raceRes = await db.collection('race_events').doc(eventId).get().catch(() => null);
    if (!raceRes || !raceRes.data) return { success: false, error: '赛事不存在' };
    const race = raceRes.data;
    const province = race.province;
    const raceName = race.name || '赛事';

    if (!province) return { success: false, error: '该赛事未设置举办省份，无法定位负责人' };

    // 0.2 已举办完成的赛事不再通知（date < 北京时间今天0点 或 status='finished'）
    //    注：status 仅导入时计算不实时刷新，故以 date 为准
    const startOfToday = (() => {
      const bj = new Date(Date.now() + 8 * 3600 * 1000);
      return new Date(Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate()) - 8 * 3600 * 1000);
    })();
    const raceDate = new Date(race.date);
    if (race.status === 'finished' || raceDate.getTime() < startOfToday.getTime()) {
      return { success: true, skipped: true, message: '赛事已举办完成，无需通知' };
    }

    // 0.5 防骚扰：同一赛事同一原因每天只通知一次（按 reason+eventId+日期 去重）
    const today = new Date();
    const dayKey = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
    const dupRes = await db.collection('qr_owner_notify_log').where({
      eventId,
      reason,
      dayKey,
    }).count();
    if (dupRes.total > 0) {
      return { success: true, deduped: true, message: '今日已通知过负责人' };
    }

    // 1. 找负责该省的所有 active 管理员
    // admins.provinces 是数组，用 elemMatch
    const now = new Date();
    const adminsRes = await db.collection('admins').where({
      status: 'active',
      validFrom: _.lte(now),
      validTo: _.gte(now),
      provinces: province,
    }).get();
    let admins = adminsRes.data || [];

    // 如果没有匹配省份的管理员，回退到 provinces 为空数组（=负责全国）的管理员
    if (admins.length === 0) {
      const allRes = await db.collection('admins').where({
        status: 'active',
        validFrom: _.lte(now),
        validTo: _.gte(now),
        provinces: [],
      }).get();
      admins = allRes.data || [];
    }

    if (admins.length === 0) {
      // 写日志便于排查
      await db.collection('qr_owner_notify_log').add({
        data: {
          eventId, raceName, province, reason,
          reporterId: reporterId || '',
          dayKey,
          createTime: new Date(),
          status: 'no_admin',
          sentCount: 0,
        },
      }).catch(() => {});
      return { success: true, sentCount: 0, message: '未找到负责该省的活跃管理员' };
    }

    // 2. 拿这些管理员的 openid
    const userIds = admins.map(a => a.userId).filter(Boolean);
    const userRes = await db.collection('users').where({ _id: _.in(userIds) }).get();
    const userMap = {};
    (userRes.data || []).forEach(u => { userMap[u._id] = u; });

    const msgData = getMsg(reason, raceName);
    let sentCount = 0;
    const errors = [];

    for (const a of admins) {
      const u = userMap[a.userId];
      if (!u || !u.openid) {
        errors.push({ adminId: a._id, reason: 'no_openid' });
        continue;
      }
      try {
        const r = await cloud.callFunction({
          name: 'sendSubscribeMsg',
          data: {
            openid: u.openid,
            templateId: TEMPLATE_ID,
            page: `/pages/admin/races/races?id=${eventId}`,
            data: msgData,
          },
        });
        if (r && r.result && r.result.ok) {
          sentCount++;
        } else {
          errors.push({ adminId: a._id, reason: 'send_fail', err: (r && r.result && r.result.error) || 'unknown' });
        }
      } catch (err) {
        errors.push({ adminId: a._id, reason: 'exception', err: err.message });
      }
    }

    // 3. 写日志
    await db.collection('qr_owner_notify_log').add({
      data: {
        eventId, raceName, province, reason,
        reporterId: reporterId || '',
        dayKey,
        createTime: new Date(),
        status: sentCount > 0 ? 'sent' : 'all_fail',
        sentCount,
        errors,
      },
    }).catch(e => console.warn('write qr_owner_notify_log failed:', e.message));

    return { success: true, sentCount, adminCount: admins.length, errors };
  } catch (err) {
    console.error('notifyRaceQrOwner error:', err);
    return { success: false, error: err.message };
  }
};
