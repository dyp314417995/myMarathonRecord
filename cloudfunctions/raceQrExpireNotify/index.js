// cloudfunctions/raceQrExpireNotify - 每天 10:00 定时触发
// 扫描所有 race_events：qrCode 为空 / qrCodeUpdatedAt 距今 >=7 天 的赛事
// 按 province 分组，每个 province 合并成一条通知推给该省的所有 active 管理员
// 一天只通知一次（qr_owner_notify_log 去重）
const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d5gy0iuiba5f9300f' });
const db = cloud.database();
const _ = db.command;

const TEMPLATE_ID = 'xepY9QmUT4YPXUt7mLhQrtlVBcN01eGkk-NqH0Av5Ew';
const QR_EXPIRE_DAYS = 7;

const truncate = (s, n) => {
  if (!s) return '';
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

// 按 province 分组，统计缺失/过期的赛事名
function buildProvinceReport(racesMissing, racesExpired) {
  const map = {};
  const addRace = (race, kind) => {
    const p = race.province || '未知';
    if (!map[p]) map[p] = { province: p, missing: [], expired: [] };
    const arr = kind === 'missing' ? map[p].missing : map[p].expired;
    if (arr.length < 5) arr.push(truncate(race.name, 12)); // 单省最多列 5 个
  };
  racesMissing.forEach(r => addRace(r, 'missing'));
  racesExpired.forEach(r => addRace(r, 'expired'));
  return Object.values(map);
}

function getMsg(province, summary) {
  const today = new Date();
  const ds = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  // thing2 限 20 字
  const thing2 = truncate(`${province} ${summary}`, 19);
  return {
    date1: { value: ds },
    thing2: { value: thing2 },
    time3: { value: '点此处理' },
  };
}

exports.main = async (event, context) => {
  try {
    const today = new Date();
    const dayKey = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
    const expireBefore = new Date(Date.now() - QR_EXPIRE_DAYS * 86400000);

    // 0. 防重复跑：当天已跑过则直接退出（防止误触发/重试）
    const flagRes = await db.collection('race_qr_expire_notify_log').where({
      dayKey,
      source: 'cron',
    }).count();
    if (flagRes.total > 0) {
      return { success: true, deduped: true, message: '今日已通知过，跳过' };
    }

    // 1. 拉所有有二维码状态问题的赛事（限定未结束的，避免噪音）
    //   - 已举办完成（date < 今天0点 或 status='finished'）的赛事不再通知
    //   - qrCode 缺失（空/不存在）
    //   - qrCode 存在但 qrCodeUpdatedAt <= expireBefore（过期）
    // 注：status 仅导入时计算不实时刷新，故以 date 为准（status 作兜底）
    // 用两条 query 分别取（云数据库 _.or 在不同条件组合下行为复杂，显式分开更稳）
    const startOfToday = (() => {
      // 云函数运行在 UTC，换算北京时间今天 0 点
      const bj = new Date(Date.now() + 8 * 3600 * 1000);
      return new Date(Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate()) - 8 * 3600 * 1000);
    })();
    const upcomingFilter = { status: _.neq('finished'), date: _.gte(startOfToday) }; // 即将开始/进行中（含今天）的赛事
    const racesMissing = (await db.collection('race_events').where({
      ...upcomingFilter,
      $or: [
        { qrCode: _.in(['', null]) },
        { qrCode: { $exists: false } },
      ],
    }).limit(500).get()).data || [];

    const racesExpired = (await db.collection('race_events').where({
      ...upcomingFilter,
      qrCode: db.command.not(_.in(['', null])),
      qrCodeUpdatedAt: _.lte(expireBefore),
    }).limit(500).get()).data || [];

    const total = racesMissing.length + racesExpired.length;
    if (total === 0) {
      // 仍写一条日志便于排查
      await db.collection('race_qr_expire_notify_log').add({
        data: {
          dayKey, source: 'cron',
          createTime: new Date(),
          totalRaces: 0,
          sentCount: 0,
          status: 'no_issue',
        },
      }).catch(() => {});
      return { success: true, total: 0, message: '无需通知' };
    }

    // 2. 按 province 分组
    const reports = buildProvinceReport(racesMissing, racesExpired);

    // 3. 找所有 active 管理员（按 province 反查）
    const now = new Date();
    const adminsRes = await db.collection('admins').where({
      status: 'active',
      validFrom: _.lte(now),
      validTo: _.gte(now),
    }).get();
    const allAdmins = adminsRes.data || [];

    // 4. 给每个 province 找负责人并发送（每个管理员一条合并通知）
    let sentCount = 0;
    const detail = [];
    for (const rep of reports) {
      // 匹配负责该省的管理员
      let matched = allAdmins.filter(a => Array.isArray(a.provinces) && a.provinces.includes(rep.province));
      // 兜底：负责全国（provinces=[]）的也算
      if (matched.length === 0) {
        matched = allAdmins.filter(a => Array.isArray(a.provinces) && a.provinces.length === 0);
      }
      if (matched.length === 0) {
        detail.push({ province: rep.province, status: 'no_admin' });
        continue;
      }

      // 拼接文案
      const parts = [];
      if (rep.missing.length) parts.push(`缺${rep.missing.length}个`);
      if (rep.expired.length) parts.push(`过期${rep.expired.length}个`);
      const summary = parts.join('，') + '群二维码';

      const msgData = getMsg(rep.province, summary);

      // 拿 openid
      const userIds = matched.map(a => a.userId).filter(Boolean);
      const userRes = await db.collection('users').where({ _id: _.in(userIds) }).get();
      const userMap = {};
      (userRes.data || []).forEach(u => { userMap[u._id] = u; });

      for (const a of matched) {
        const u = userMap[a.userId];
        if (!u || !u.openid) continue;
        try {
          const r = await cloud.callFunction({
            name: 'sendSubscribeMsg',
            data: {
              openid: u.openid,
              templateId: TEMPLATE_ID,
              page: `/pages/admin/races/races?province=${encodeURIComponent(rep.province)}`,
              data: msgData,
            },
          });
          if (r && r.result && r.result.ok) sentCount++;
        } catch (err) {
          console.warn('send fail', a._id, err.message);
        }
      }
      detail.push({ province: rep.province, status: 'sent', adminCount: matched.length });
    }

    // 5. 写日志
    await db.collection('race_qr_expire_notify_log').add({
      data: {
        dayKey, source: 'cron',
        createTime: new Date(),
        totalRaces: total,
        sentCount,
        detail,
        status: sentCount > 0 ? 'sent' : 'no_send',
      },
    }).catch(e => console.warn('write log failed:', e.message));

    return { success: true, total, sentCount, provinces: reports.length };
  } catch (err) {
    console.error('raceQrExpireNotify error:', err);
    return { success: false, error: err.message };
  }
};
