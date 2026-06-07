// 云函数：pointsExpireCheck - 积分过期处理
// 配置定时触发器：每天凌晨 2 点执行
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async () => {
  const now = new Date();
  const results = { expired: 0, notified30: 0, notified7: 0, notified1: 0 };

  // 1. 处理今天到期的积分
  const overdueRes = await db.collection('points_records').where({
    status: 'approved', type: 'earn',
    expireDate: _.lte(now),
  }).get();

  for (const r of overdueRes.data) {
    // 扣减余额快照记录
    await db.collection('points_records').add({
      data: {
        userId: r.userId, type: 'expire', category: '积分过期',
        points: -r.points, status: 'approved',
        description: `积分过期自动扣减（${r.category}）`,
        images: [], earnDate: r.earnDate,
        expireDate: r.expireDate, createTime: now,
      },
    });
    // 标记原记录过期
    await db.collection('points_records').doc(r._id).update({ data: { status: 'expired' } });
  }
  results.expired = overdueRes.data.length;

  // 2. 查询未来 30/7/1 天到期的积分，推送订阅消息
  const sendReminder = async (days) => {
    const target = new Date(now.getTime() + days * 86400000);
    const start = new Date(target.getFullYear(), target.getMonth(), target.getDate(), 0, 0, 0);
    const end = new Date(target.getFullYear(), target.getMonth(), target.getDate(), 23, 59, 59);

    const res = await db.collection('points_records').where({
      status: 'approved', type: 'earn',
      expireDate: _.gte(start).and(_.lte(end)),
    }).get();

    // 按用户去重
    const users = [...new Set(res.data.map(r => r.userId))];
    const expiringPoints = res.data.reduce((sum, r) => sum + r.points, 0);

    for (const uid of users) {
      try {
        await cloud.openapi.subscribeMessage.send({
          touser: uid,
          templateId: '', // TODO: 替换为实际的订阅消息模板ID
          data: {
            thing1: { value: '积分即将过期' },
            number2: { value: String(expiringPoints) },
            date3: { value: `${days}天后` },
            thing4: { value: `你有积分将在${days}天后过期，请及时使用` },
          },
        });
      } catch (e) {
        // 用户未订阅或模板ID未配置时忽略
        console.log(`提醒用户 ${uid} 失败:`, e.message);
      }
    }
    return res.data.length;
  };

  results.notified30 = await sendReminder(30);
  results.notified7 = await sendReminder(7);
  results.notified1 = await sendReminder(1);

  return { success: true, results };
};
