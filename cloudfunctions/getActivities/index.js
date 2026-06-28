// cloudfunctions/getActivities - 活动CRUD
const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { action, id, data, userId, skip, limit } = event || {};

  if (action === 'create') {
    return await db.collection('activities').add({ data: { ...data, status: 'active', createTime: new Date() } });
  }
  if (action === 'update') {
    return await db.collection('activities').doc(id).update({ data });
  }
  if (action === 'cancel') {
    await db.collection('activities').doc(id).update({ data: { status: 'cancelled' } });
    await db.collection('activity_registrations').where({ activityId: id }).update({ data: { status: 'cancelled' } });
    return { ok: true };
  }
  if (action === 'finish') {
    await db.collection('activities').doc(id).update({ data: { status: 'finished' } });
    // 获取活动名，给所有报名用户加分
    const act = await db.collection('activities').doc(id).get();
    const regs = await db.collection('activity_registrations').where({ activityId: id, status: 'active' }).get();
    for (const r of regs.data) {
      // 写入积分记录
      await db.collection('points_records').add({
        data: {
          userId: r.userId,
          type: 'earn',
          category: '集体活动',
          points: 3,
          description: `参加活动：${act.data.name}`,
          status: 'approved',
          createTime: new Date(),
          earnDate: new Date(),
          expireDate: new Date(Date.now() + 365 * 86400000),
        },
      });
      // 更新用户余额
      const user = await db.collection('users').doc(r.userId).get();
      const balance = (user.data.points || 0) + 3;
      await db.collection('users').doc(r.userId).update({ data: { points: balance } });
    }
    return { ok: true, awarded: regs.data.length };
  }
  if (action === 'delete') {
    await db.collection('activities').doc(id).remove();
    await db.collection('activity_registrations').where({ activityId: id }).remove();
    return { ok: true };
  }
  if (action === 'detail') {
    const act = await db.collection('activities').doc(id).get();
    return act.data;
  }

  // 列表：未过期活动
  if (action === 'list') {
    const now = new Date();
    const res = await db.collection('activities')
      .where({ status: 'active', timeStart: _.gte(now) })
      .orderBy('timeStart', 'asc')
      .skip(skip || 0)
      .limit(limit || 20)
      .get();
    // 批量查报名数
    const ids = res.data.map(a => a._id);
    const countMap = {};
    if (ids.length) {
      const regs = await db.collection('activity_registrations')
        .where({ activityId: _.in(ids), status: 'active' }).get();
      regs.data.forEach(r => { countMap[r.activityId] = (countMap[r.activityId] || 0) + 1; });
    }
    return {
      list: res.data.map(a => ({ ...a, regCount: countMap[a._id] || 0 })),
    };
  }

  // 所有活动（管理端）
  if (action === 'all') {
    const res = await db.collection('activities')
      .orderBy('timeStart', 'desc')
      .skip(skip || 0)
      .limit(limit || 20)
      .get();
    const ids = res.data.map(a => a._id);
    const countMap = {};
    if (ids.length) {
      const regs = await db.collection('activity_registrations')
        .where({ activityId: _.in(ids), status: 'active' }).get();
      regs.data.forEach(r => { countMap[r.activityId] = (countMap[r.activityId] || 0) + 1; });
    }
    return {
      list: res.data.map(a => ({ ...a, regCount: countMap[a._id] || 0 })),
    };
  }

  // 我的活动（用户报名过的）
  if (action === 'my') {
    const regs = await db.collection('activity_registrations')
      .where({ userId, status: 'active' })
      .orderBy('createTime', 'desc')
      .get();
    if (!regs.data.length) return { list: [] };
    const actIds = [...new Set(regs.data.map(r => r.activityId))];
    const acts = await db.collection('activities')
      .where({ _id: _.in(actIds) })
      .orderBy('timeStart', 'asc')
      .get();
    // 报名人数
    const countMap = {};
    const allRegs = await db.collection('activity_registrations')
      .where({ activityId: _.in(actIds), status: 'active' }).get();
    allRegs.data.forEach(r => { countMap[r.activityId] = (countMap[r.activityId] || 0) + 1; });
    return {
      list: acts.data.map(a => ({ ...a, regCount: countMap[a._id] || 0 })),
    };
  }

  // 报名
  if (action === 'register') {
    const { activityId, userInfo, customValues } = event;
    // 检查是否已报名
    const exist = await db.collection('activity_registrations')
      .where({ activityId, userId: userInfo._id, status: 'active' }).get();
    if (exist.data.length) return { error: '已报名' };
    // 检查人数上限
    const act = await db.collection('activities').doc(activityId).get();
    if (act.data.maxPeople) {
      const cnt = await db.collection('activity_registrations')
        .where({ activityId, status: 'active' }).count();
      if (cnt.total >= act.data.maxPeople) return { error: '已满员' };
    }
    return await db.collection('activity_registrations').add({
      data: {
        activityId, userId: userInfo._id,
        userName: userInfo.nickName || '',
        userPhone: userInfo.phone || '',
        customValues: customValues || {},
        status: 'active',
        createTime: new Date(),
      },
    });
  }

  // 取消报名
  if (action === 'unregister') {
    await db.collection('activity_registrations')
      .where({ activityId: event.activityId, userId })
      .update({ data: { status: 'cancelled' } });
    return { ok: true };
  }

  // 报名列表（管理端）
  if (action === 'registrations') {
    const res = await db.collection('activity_registrations')
      .where({ activityId: id, status: 'active' })
      .orderBy('createTime', 'asc')
      .get();
    return { list: res.data };
  }

  return { error: 'unknown action' };
};
