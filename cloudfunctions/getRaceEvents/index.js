// cloudfunctions/getRaceEvents/index.js - 分页查询赛事 + 评分统计（按赛事组聚合）
const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { skip = 0, limit = 20, search, dateFrom, dateTo, raceType, raceLevel, raceLabel, userId } = event || {};
  const wxContext = cloud.getWXContext();
  const uid = userId || wxContext.OPENID;

  const cond = {};
  if (search) {
    const regex = db.RegExp({ regexp: search, options: 'i' });
    cond._id = _.or([{ name: regex }, { city: regex }]);
  }

  let ref = db.collection('race_events');
  if (Object.keys(cond).length) ref = ref.where(cond);

  const countRes = await ref.count();
  const total = countRes.total;

  const res = await ref.orderBy('date', 'desc').skip(skip).limit(limit).get();
  let list = res.data;
  if (raceType) list = list.filter(r => (r.raceTypes || [r.raceType]).includes(raceType));
  if (raceLevel) list = list.filter(r => r.raceLevel === raceLevel);
  if (raceLabel) list = list.filter(r => r.label === raceLabel);
  if (dateFrom) {
    const from = new Date(dateFrom);
    list = list.filter(r => r.date && new Date(r.date) >= from);
  }
  if (dateTo) {
    const to = new Date(dateTo);
    to.setHours(23, 59, 59, 999);
    list = list.filter(r => r.date && new Date(r.date) <= to);
  }

  // 收集所有 raceGroup，批量查询评价
  const groups = [...new Set(list.map(r => r.raceGroup).filter(Boolean))];
  const groupStatsMap = {};
  const groupEventIds = {}; // 提前初始化

  if (groups.length) {
    // 查出所有同raceGroup的赛事ID
    const groupEvents = await db.collection('race_events').where({ raceGroup: _.in(groups) }).get();
    groupEvents.data.forEach(e => { if (!groupEventIds[e.raceGroup]) groupEventIds[e.raceGroup] = []; groupEventIds[e.raceGroup].push(e._id); });

    for (const g of groups) {
      const eids = groupEventIds[g] || [];
      // 既按 raceGroup 查，也按同组所有 eventId 查（兼容旧评价没有 raceGroup）
      const revRes = await db.collection('race_reviews').where(_.or([
        { raceGroup: g, status: 'approved' },
        { eventId: _.in(eids), status: 'approved' }
      ])).get();
      const revs = revRes.data;
      if (!revs.length) continue;

      const count = revs.length;
      const dims = {};
      let totalScore = 0;
      // 分全马半马
      const fullList = revs.filter(r => r.raceType === 'full');
      const halfList = revs.filter(r => r.raceType === 'half');

      revs.forEach(r => {
        const scores = r.scores || {};
        let sum = 0, c = 0;
        Object.keys(scores).forEach(k => { dims[k] = (dims[k] || 0) + scores[k]; sum += scores[k]; c++; });
        totalScore += sum / c;
      });

      const dimensions = {};
      Object.keys(dims).forEach(k => { dimensions[k] = Math.round(dims[k] / count * 10) / 10; });

      const calcType = (arr) => {
        if (!arr.length) return null;
        const td = {};
        let ts = 0;
        arr.forEach(r => {
          const s = r.scores || {};
          let sum = 0, c = 0;
          Object.keys(s).forEach(k => { td[k] = (td[k] || 0) + s[k]; sum += s[k]; c++; });
          ts += sum / c;
        });
        const d = {};
        Object.keys(td).forEach(k => { d[k] = Math.round(td[k] / arr.length * 10) / 10; });
        return { count: arr.length, avgScore: Math.round(ts / arr.length * 10) / 10, dimensions: d };
      };

      // 按 eventId 分组的单赛事统计
      const perEvent = {};
      revs.forEach(r => { if (!perEvent[r.eventId]) perEvent[r.eventId] = []; perEvent[r.eventId].push(r); });
      const perEventStats = {};
      Object.entries(perEvent).forEach(([eid, arr]) => {
        const dims2 = {};
        let t2 = 0;
        arr.forEach(r => {
          const s = r.scores || {};
          let sum = 0, c = 0;
          Object.keys(s).forEach(k => { dims2[k] = (dims2[k] || 0) + s[k]; sum += s[k]; c++; });
          t2 += sum / c;
        });
        const d2 = {};
        Object.keys(dims2).forEach(k => { d2[k] = Math.round(dims2[k] / arr.length * 10) / 10; });
        perEventStats[eid] = { count: arr.length, avgScore: Math.round(t2 / arr.length * 10) / 10 };
      });

      groupStatsMap[g] = {
        count,
        avgScore: Math.round(totalScore / count * 10) / 10,
        dimensions,
        fullStats: calcType(fullList),
        halfStats: calcType(halfList),
        perEventStats,
      };
    }
  }

  // 查询当前用户评价过的赛事组
  let userReviewedGroups = new Set();
  let userReviewedEvents = new Set();
  if (uid) {
    // OPENID → 用户 _id
    let userIdFromDb = uid;
    try {
      const userRes = await db.collection('users').where({ _openid: uid }).get();
      if (userRes.data[0]) userIdFromDb = userRes.data[0]._id;
    } catch {}
    const myRv = await db.collection('race_reviews').where({ userId: userIdFromDb }).get();
    myRv.data.forEach(r => { if (r.raceGroup) userReviewedGroups.add(r.raceGroup); if (r.eventId) userReviewedEvents.add(r.eventId); });
  }

  // 同 raceGroup 的赛事也算已评价
  const allGroupIds = {};
  Object.keys(groupEventIds).forEach(g => { allGroupIds[g] = new Set(groupEventIds[g]); });

  const result = list.map(r => {
    const g = r.raceGroup;
    const reviewedViaGroup = g && userReviewedGroups.has(g);
    const reviewedViaEvent = r._id && userReviewedEvents.has(r._id);
    const reviewedViaGroupEvent = g && allGroupIds[g] && [...allGroupIds[g]].some(eid => userReviewedEvents.has(eid));
    const groupStats = g ? (groupStatsMap[g] || {}) : {};
    const evtStats = groupStats.perEventStats ? (groupStats.perEventStats[r._id] || {}) : {};
    return {
      ...r,
      reviewStats: { count: groupStats.count || 0, avgScore: groupStats.avgScore || 0, dimensions: groupStats.dimensions || {}, fullStats: groupStats.fullStats, halfStats: groupStats.halfStats },
      // 列表卡片用单赛事统计
      avgScore: evtStats.avgScore || 0,
      reviewCount: evtStats.count || 0,
      hasReviewed: reviewedViaGroup || reviewedViaEvent || reviewedViaGroupEvent,
    };
  });

  return { list: result, total, hasMore: skip + limit < total };
};
