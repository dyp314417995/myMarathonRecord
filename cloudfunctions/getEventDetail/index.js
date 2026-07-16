// 云函数 getEventDetail - 查询单条赛事详情 + 评分统计 + 用户标记/评价
const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { eventId, userId } = event;
  if (!eventId) return { error: '缺少 eventId' };

  // 1. 查赛事
  const evtRes = await db.collection('race_events').doc(eventId).get();
  const evt = evtRes.data;
  if (!evt) return { error: '赛事不存在' };

  // 2. 查同 raceGroup 的评分统计
  const raceGroup = evt.raceGroup;
  let reviewStats = { count: 0, avgScore: 0, dimensions: {}, tagStats: {} };
  let groupEventIds = [eventId];

  if (raceGroup) {
    const grpRes = await db.collection('race_events').where({ raceGroup }).get();
    groupEventIds = grpRes.data.map(e => e._id);

    const revRes = await db.collection('race_reviews').where(_.or([
      { raceGroup, status: 'approved' },
      { eventId: _.in(groupEventIds), status: 'approved' }
    ])).get();
    const revs = revRes.data;

    if (revs.length) {
      const count = revs.length;
      const dims = {};
      let totalScore = 0;
      const tagStats = {};

      const fullList = revs.filter(r => r.raceType === 'full');
      const halfList = revs.filter(r => r.raceType === 'half');

      revs.forEach(r => {
        const scores = r.scores || {};
        let sum = 0, c = 0;
        Object.keys(scores).forEach(k => { dims[k] = (dims[k] || 0) + scores[k]; sum += scores[k]; c++; });
        totalScore += sum / c;
        (r.tags || []).forEach(t => { tagStats[t] = (tagStats[t] || 0) + 1; });
      });

      const dimensions = {};
      Object.keys(dims).forEach(k => { dimensions[k] = Math.round(dims[k] / count * 10) / 10; });

      const calcType = (arr) => {
        if (!arr.length) return null;
        const td = {}; let ts = 0;
        arr.forEach(r => {
          const s = r.scores || {}; let sum = 0, c = 0;
          Object.keys(s).forEach(k => { td[k] = (td[k] || 0) + s[k]; sum += s[k]; c++; });
          ts += sum / c;
        });
        const d = {};
        Object.keys(td).forEach(k => { d[k] = Math.round(td[k] / arr.length * 10) / 10; });
        return { count: arr.length, avgScore: Math.round(ts / arr.length * 10) / 10, dimensions: d };
      };

      reviewStats = {
        count,
        avgScore: Math.round(totalScore / count * 10) / 10,
        dimensions,
        tagStats,
        fullStats: calcType(fullList),
        halfStats: calcType(halfList),
      };
    }
  }

  // 3. 查用户标记和评价
  let myMarker = null;
  let myReview = null;
  if (userId) {
    try {
      const mkRes = await db.collection('race_markers').where({ userId, eventId }).limit(1).get();
      myMarker = mkRes.data[0] || null;
    } catch (e) { console.warn('getEventDetail markers:', e); }

    try {
      const rvRes = await db.collection('race_reviews').where({ userId, eventId }).limit(1).get();
      myReview = rvRes.data[0] || null;
    } catch (e) { console.warn('getEventDetail reviews:', e); }
  }

  return { event: evt, reviewStats, myMarker, myReview };
};
