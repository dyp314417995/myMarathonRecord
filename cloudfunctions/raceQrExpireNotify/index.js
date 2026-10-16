// cloudfunctions/raceQrExpireNotify - 每天 10:00 定时触发
// 扫描所有 race_events：qrCode 为空 / qrCodeUpdatedAt 距今 >=7 天 的赛事
// 按省合并成一条通知（「缺N个，过期M个群二维码」+ 赛事名列表），推给负责该省的 active 管理员
// 点击通知进管理页并自动套二维码筛选（page 带 qrScope）；赛事级开关 qrNotifyDisabled=true 的不发
// 一天只跑一次（race_qr_expire_notify_log 去重）
const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d5gy0iuiba5f9300f' });
const db = cloud.database();
const _ = db.command;

const TEMPLATE_ID = 'xepY9QmUT4YPXUt7mLhQrtlVBcN01eGkk-NqH0Av5Ew';
const QR_EXPIRE_DAYS = 7;

// ===== 二维码通知专用模板（与 notifyRaceQrOwner 保持一致）=====
const QR_TEMPLATE_ID = 'mcDtCsiTEPabnEEWb317RnQT4K12zkoknB02GfQZHN4';
// 实际字段：thing1/thing2/thing3（与实时通知模板一致）
const QR_MSG_KEYS = { name: 'thing1', content: 'thing2', tip: 'thing3' };

const truncate = (s, n) => {
  if (!s) return '';
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

// 旧报名提醒模板的消息体（回退用）
function getMsg(province, summary) {
  const today = new Date();
  const ds = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const thing2 = truncate(`${province} ${summary}`, 19);
  return {
    date1: { value: ds },
    thing2: { value: thing2 },
    time3: { value: ds },
  };
}

// 专用模板的消息体：省份 + 数量汇总 + 赛事名列表（按省合并一条，点击进管理页套筛选）
function getQrMsg(province, summary, names) {
  return {
    [QR_MSG_KEYS.name]: { value: truncate(province, 20) },
    [QR_MSG_KEYS.content]: { value: truncate(summary, 20) },
    [QR_MSG_KEYS.tip]: { value: truncate(names, 20) },
  };
}

exports.main = async (event, context) => {
  try {
    const today = new Date();
    const dayKey = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
    const expireBefore = new Date(Date.now() - QR_EXPIRE_DAYS * 86400000);

    // 0. 防重复跑：当天已跑过则直接退出（防止误触发/重试）
    // 注：集合不存在(-502005)等查询异常不阻断流程，仅跳过去重
    const flagRes = await db.collection('race_qr_expire_notify_log').where({
      dayKey,
      source: 'cron',
    }).count().catch(() => null);
    if (flagRes && flagRes.total > 0) {
      return { success: true, deduped: true, message: '今日已通知过，跳过' };
    }

    // 0.5 取上一次运行（今天之前最近一条）的分省数量，用于「有变化才发」：
    //     某省缺失/过期数量与上次完全一致 = 已提醒过且无新增无进展，不重复打扰
    const prevRes = await db.collection('race_qr_expire_notify_log').where({
      source: 'cron',
      dayKey: _.neq(dayKey),
    }).orderBy('createTime', 'desc').limit(1).get().catch(() => null);
    const prevMap = {};
    if (prevRes && prevRes.data && prevRes.data.length) {
      ((prevRes.data[0].detail) || []).forEach(d => {
        prevMap[d.province] = `${d.missing || 0}-${d.expired || 0}`;
      });
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
    // 模式派生：'all' 正常推送定时通知 | 'expired' 关闭整个定时通知（缺+过期都不发）
    // 手动催办不受此开关影响（详见 notifyRaceQrOwner）
    // 老数据 qrNotifyDisabled=true 等同 'expired'（关闭）
    const modeOf = (r) => r.qrNotifyMode || (r.qrNotifyDisabled ? 'expired' : 'all');
    const allowPush = (r) => modeOf(r) === 'all';
    const racesMissing = ((await db.collection('race_events').where({
      ...upcomingFilter,
      $or: [
        { qrCode: _.in(['', null]) },
        { qrCode: { $exists: false } },
      ],
    }).limit(500).get()).data || []).filter(allowPush);

    const racesExpired = ((await db.collection('race_events').where({
      ...upcomingFilter,
      qrCode: db.command.not(_.in(['', null])),
      qrCodeUpdatedAt: _.lte(expireBefore),
    }).limit(500).get()).data || []).filter(allowPush);

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

    // 2. 找所有 active 管理员（一次性拉齐，后面逐赛事匹配）
    const now = new Date();
    const adminsRes = await db.collection('admins').where({
      status: 'active',
      validFrom: _.lte(now),
      validTo: _.gte(now),
    }).get();
    const allAdmins = adminsRes.data || [];

    // 省份名归一化：管理员配置全称（吉林省），赛事数据简称（吉林），归一化后比较
    const PROVINCE_ALIAS = {
      '北京市': '北京', '天津市': '天津', '上海市': '上海', '重庆市': '重庆',
      '内蒙古自治区': '内蒙古', '广西壮族自治区': '广西', '西藏自治区': '西藏',
      '宁夏回族自治区': '宁夏', '新疆维吾尔自治区': '新疆',
      '香港特别行政区': '香港', '澳门特别行政区': '澳门',
      '兵团': '新疆',
    };
    const canonProvince = (name) => {
      if (!name) return '';
      if (PROVINCE_ALIAS[name]) return PROVINCE_ALIAS[name];
      return String(name).replace(/(省|市)$/, '');
    };
    // 匹配负责该省的管理员（归一化比较；无省管则兜底负责全国的）
    const matchAdmins = (province) => {
      let matched = allAdmins.filter(a => Array.isArray(a.provinces)
        && a.provinces.some(p => canonProvince(p) === canonProvince(province)));
      if (matched.length === 0) {
        matched = allAdmins.filter(a => !Array.isArray(a.provinces) || a.provinces.length === 0);
      }
      return matched;
    };

    // 拿全部管理员 openid（一次）
    const userIds = [...new Set(allAdmins.map(a => a.userId).filter(Boolean))];
    const userRes = await db.collection('users').where({ _id: _.in(userIds) }).get();
    const userMap = {};
    (userRes.data || []).forEach(u => { userMap[u._id] = u; });

    // 3. 按省合并发送：每省一条（数量汇总 + 赛事名列表），点击进管理页自动套二维码筛选
    //    无额度(43101)的管理员短路跳过，避免无谓调用
    const useQrTpl = !!QR_TEMPLATE_ID;
    const noQuotaAdmins = new Set(); // 已确认无订阅额度的管理员，本次运行直接跳过
    let sentCount = 0;
    const detail = [];

    const groupMap = {};
    const addRace = (r, kind) => {
      const p = r.province || '未知';
      if (!groupMap[p]) groupMap[p] = { province: p, missing: [], expired: [] };
      groupMap[p][kind].push(r);
    };
    racesMissing.forEach(r => addRace(r, 'missing'));
    racesExpired.forEach(r => addRace(r, 'expired'));

    for (const g of Object.values(groupMap)) {
      // 有变化才发：该省数量与上次运行完全一致则跳过（已提醒过，无新增无进展）
      const curKey = `${g.missing.length}-${g.expired.length}`;
      if (prevMap[g.province] === curKey) {
        detail.push({ province: g.province, status: 'skipped_no_change', missing: g.missing.length, expired: g.expired.length });
        continue;
      }

      const matched = matchAdmins(g.province);
      if (matched.length === 0) {
        detail.push({ province: g.province, status: 'no_admin', missing: g.missing.length, expired: g.expired.length });
        continue;
      }

      // 消息体：省份 + 摘要 + 赛事名列表（先缺后过期，超 20 字截断）
      // 三种场景文案明确分开，避免「缺/过期」两种情况读起来一样
      let summary;
      if (g.missing.length && g.expired.length) {
        summary = `缺${g.missing.length}、过期${g.expired.length}个群二维码`;
      } else if (g.missing.length) {
        summary = `缺${g.missing.length}个群二维码待上传`;
      } else {
        summary = `${g.expired.length}个群二维码已过期需更新`;
      }
      const names = [...g.missing, ...g.expired].map(r => r.name).join('、');
      const msgData = useQrTpl ? getQrMsg(g.province, summary, names) : getMsg(g.province, summary);

      // 点击跳转：管理页 + 自动套二维码筛选（有缺优先看缺）
      const qrScope = g.missing.length ? 'missing' : 'expired';
      const page = `/pages/admin/races/races?qrScope=${qrScope}`;

      let ok = 0;
      for (const a of matched) {
        if (noQuotaAdmins.has(a._id)) continue;
        const u = userMap[a.userId];
        if (!u || !u.openid) continue;
        try {
          const res = await cloud.callFunction({
            name: 'sendSubscribeMsg',
            data: {
              openid: u.openid,
              templateId: useQrTpl ? QR_TEMPLATE_ID : TEMPLATE_ID,
              page,
              data: msgData,
            },
          });
          if (res && res.result && res.result.ok) {
            sentCount++;
            ok++;
          } else if (res && res.result && /43101/.test(res.result.error || '')) {
            // 用户无订阅额度（未订阅过该模板），本次运行不再尝试该管理员
            noQuotaAdmins.add(a._id);
          }
        } catch (err) {
          console.warn('send fail', err.message);
        }
      }
      detail.push({
        province: g.province, status: ok > 0 ? 'sent' : 'no_send', adminCount: matched.length,
        missing: g.missing.length, expired: g.expired.length,
        races: [...g.missing, ...g.expired].map(r => truncate(r.name, 20)),
      });
    }

    // 4. 写日志
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

    return { success: true, total, sentCount, provinces: Object.keys(groupMap).length };
  } catch (err) {
    console.error('raceQrExpireNotify error:', err);
    return { success: false, error: err.message };
  }
};
