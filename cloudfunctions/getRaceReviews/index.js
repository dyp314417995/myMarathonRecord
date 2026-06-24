// cloudfunctions/getRaceReviews/index.js
const cloud = require('wx-server-sdk');
cloud.init();

exports.main = async (event) => {
  const { action, eventId } = event;
  const db = cloud.database();

  if (action === 'stats') {
    const res = await db.collection('race_reviews').where({ eventId, status: 'approved' }).get();
    const count = res.data.length;
    if (count === 0) return { count: 0, avgScore: 0, dimensions: {}, tagStats: {} };

    const dims = {};
    const tags = {};
    let total = 0;
    res.data.forEach(r => {
      const scores = r.scores || {};
      let sum = 0; let dimCount = 0;
      Object.keys(scores).forEach(k => {
        dims[k] = (dims[k] || 0) + scores[k];
        sum += scores[k]; dimCount++;
      });
      total += sum / dimCount;
      (r.tags || []).forEach(t => { tags[t] = (tags[t] || 0) + 1; });
    });

    const avgScore = Math.round(total / count * 10) / 10;
    const dimensions = {};
    Object.keys(dims).forEach(k => { dimensions[k] = Math.round(dims[k] / count * 10) / 10; });

    return { count, avgScore, dimensions, tagStats: tags };
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
