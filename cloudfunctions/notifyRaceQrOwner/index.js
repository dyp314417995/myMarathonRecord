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

// ===== 二维码通知专用模板 =====
// 公众平台创建的专用模板；实际字段：thing1/thing2/thing3（time3 不是模板字段，已实测）
const QR_TEMPLATE_ID = 'mcDtCsiTEPabnEEWb317RnQT4K12zkoknB02GfQZHN4';
// 按实际模板的关键词 ID 调整（公众平台模板详情里的 thing1/thing2/thing3 等字段名）
const QR_MSG_KEYS = { name: 'thing1', content: 'thing2', tip: 'thing3' };

// thing2 字段限制 20 字以内，做截断
const truncate = (s, n) => {
  if (!s) return '';
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

// ===== 省份名归一化 =====
// 管理员配置的省份是全称（吉林省/广西壮族自治区），赛事数据的 province 是简称（吉林/广西），
// 直接精确匹配会查不到负责人，统一展开成多种写法后再查询
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

function getMsg(reason, raceName) {
  const today = new Date();
  const ds = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const name = truncate(raceName, 10); // 给 thing2 留 10 字给"过期/未上传"
  // 注：time3 是时间类型字段，只接受日期/时间格式（与 checkRaceNotify 保持一致传 ds）
  if (reason === 'expired') {
    return {
      date1: { value: ds },
      thing2: { value: `${name}二维码过期啦` },
      time3: { value: ds },
    };
  }
  // missing
  return {
    date1: { value: ds },
    thing2: { value: `${name}还没上传二维码` },
    time3: { value: ds },
  };
}

// 专用模板的消息体：赛事名称 + 提醒内容 + 时间/提示
function getQrMsg(reason, raceName) {
  const today = new Date();
  const ds = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const content = reason === 'expired'
    ? '群二维码已过期，请尽快更新'
    : '群二维码未上传，请尽快上传';
  return {
    [QR_MSG_KEYS.name]: { value: truncate(raceName, 20) },
    [QR_MSG_KEYS.content]: { value: truncate(content, 20) },
    [QR_MSG_KEYS.tip]: { value: ds },
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

    // 0.1 赛事级开关：管理员可对不拉群的赛事关闭提醒（qrNotifyDisabled，缺省=开启）
    if (race.qrNotifyDisabled) {
      return { success: true, skipped: true, message: '该赛事已关闭二维码提醒' };
    }

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

    // 0.5 防骚扰：同一赛事同一原因每天只成功通知一次
    // 注1：只对 sentCount>0 的记录去重——之前"未找到负责人/发送失败"的尝试不占用当日额度，配置好管理员后可立即重试
    // 注2：集合不存在(-502005)等查询异常不阻断通知流程，仅跳过去重
    const today = new Date();
    const dayKey = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
    const dupRes = await db.collection('qr_owner_notify_log').where({
      eventId,
      reason,
      dayKey,
      sentCount: _.gt(0),
    }).count().catch(() => null);
    if (dupRes && dupRes.total > 0) {
      return { success: true, deduped: true, message: '今日已通知过负责人' };
    }

    // 1. 找负责该省的所有 active 管理员（省份名归一化：简称/全称都匹配）
    const now = new Date();
    const adminsRes = await db.collection('admins').where({
      status: 'active',
      validFrom: _.lte(now),
      validTo: _.gte(now),
      provinces: _.in(provinceVariants(province)),
    }).get();
    let admins = adminsRes.data || [];

    // 如果没有匹配省份的管理员，回退到负责全国（provinces 为空数组或字段不存在）的管理员
    if (admins.length === 0) {
      const allRes = await db.collection('admins').where({
        status: 'active',
        validFrom: _.lte(now),
        validTo: _.gte(now),
      }).get();
      // provinces 缺失（老数据）或空数组都视为负责全国
      admins = (allRes.data || []).filter(a => !Array.isArray(a.provinces) || a.provinces.length === 0);
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

    // 优先用专用模板，未配置时回退报名提醒模板
    const useQrTpl = !!QR_TEMPLATE_ID;
    const msgData = useQrTpl ? getQrMsg(reason, raceName) : getMsg(reason, raceName);
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
            templateId: useQrTpl ? QR_TEMPLATE_ID : TEMPLATE_ID,
            // 点击直达该赛事的编辑弹窗（races.js onLoad 读取 editEventId）
            page: `/pages/admin/races/races?editEventId=${eventId}`,
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
