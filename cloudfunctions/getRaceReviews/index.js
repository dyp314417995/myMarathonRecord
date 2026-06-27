// cloudfunctions/getRaceReviews/index.js
const cloud = require('wx-server-sdk');
cloud.init();

exports.main = async (event) => {
  const { action, eventId } = event;
  const db = cloud.database();

  if (action === 'all') {
    const cond = {};
    if (event.userId) cond.userId = event.userId;
    if (event.eventId) cond.eventId = event.eventId;
    const res = await db.collection('race_reviews').where(cond).orderBy('createTime', 'desc').limit(50).get();
    return res.data;
  }

  if (action === 'groupPage') {
    // 按 raceGroup 聚合，分页返回评价+用户信息
    const { raceGroup, skip, limit } = event;
    if (!raceGroup) return { list: [], total: 0 };
    const res = await db.collection('race_reviews')
      .where({ raceGroup })
      .orderBy('createTime', 'desc')
      .skip(skip || 0)
      .limit(limit || 20)
      .get();
    const countRes = await db.collection('race_reviews').where({ raceGroup }).count();

    // 补充用户昵称和赛事名称
    const userIds = [...new Set(res.data.map(r => r.userId))];
    const usersMap = {};
    if (userIds.length) {
      const usersRes = await db.collection('users').where({ _id: db.command.in(userIds) }).get();
      usersRes.data.forEach(u => { usersMap[u._id] = u.nickName || '跑友'; });
    }
    const eventIds = [...new Set(res.data.map(r => r.eventId))];
    const eventsMap = {};
    if (eventIds.length) {
      const eventsRes = await db.collection('race_events').where({ _id: db.command.in(eventIds) }).get();
      eventsRes.data.forEach(e => { eventsMap[e._id] = { name: e.name || '', date: e.date }; });
    }

    return {
      list: res.data.map(r => {
        const evt = eventsMap[r.eventId] || {};
        const eventYear = evt.date ? new Date(evt.date).getFullYear() : (r.year || '');
        return {
          ...r,
          userName: usersMap[r.userId] || '跑友',
          eventName: evt.name || '未知赛事',
          raceTypeName: r.raceType === 'half' ? '半马' : '全马',
          year: eventYear,  // 用赛事年份
        };
      }),
      total: countRes.total,
    };
  }

  if (action === 'stats') {
    const res = await db.collection('race_reviews').where({ eventId, status: 'approved' }).get();
    const count = res.data.length;
    if (count === 0) return { count: 0, avgScore: 0, dimensions: {}, tagStats: {}, fullStats: null, halfStats: null };

    // 全部分合计
    const allDims = {};
    const tags = {};
    let total = 0;
    res.data.forEach(r => {
      const scores = r.scores || {};
      let sum = 0; let dimCount = 0;
      Object.keys(scores).forEach(k => {
        allDims[k] = (allDims[k] || 0) + scores[k];
        sum += scores[k]; dimCount++;
      });
      total += sum / dimCount;
      (r.tags || []).forEach(t => { tags[t] = (tags[t] || 0) + 1; });
    });

    const avgScore = Math.round(total / count * 10) / 10;
    const dimensions = {};
    Object.keys(allDims).forEach(k => { dimensions[k] = Math.round(allDims[k] / count * 10) / 10; });

    // 分全马半马统计
    const calcTypeStats = (type) => {
      const typeList = res.data.filter(r => r.raceType === type);
      if (!typeList.length) return null;
      const dims = {};
      let t = 0;
      typeList.forEach(r => {
        const scores = r.scores || {};
        let s = 0; let c = 0;
        Object.keys(scores).forEach(k => { dims[k] = (dims[k] || 0) + scores[k]; s += scores[k]; c++; });
        t += s / c;
      });
      const avg = Math.round(t / typeList.length * 10) / 10;
      const d = {};
      Object.keys(dims).forEach(k => { d[k] = Math.round(dims[k] / typeList.length * 10) / 10; });
      return { count: typeList.length, avgScore: avg, dimensions: d };
    };

    return {
      count, avgScore, dimensions, tagStats: tags,
      fullStats: calcTypeStats('full'),
      halfStats: calcTypeStats('half'),
    };
  }

  if (action === 'updateStats') {
    const { tagStats, avgScore, reviewCount } = event;
    await db.collection('race_events').doc(eventId).update({
      data: { avgScore, reviewCount, tagStats }
    });
    return { ok: true };
  }

  return {};
};
