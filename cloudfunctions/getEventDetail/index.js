// 云函数 getEventDetail - 查询单条赛事详情 + 评分统计 + 用户标记/评价（优化版）
const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();
const _ = db.command;

// 用户身份在库里是两种写法并存的：users 表的内部 _id，以及微信 openid。
// 关注记录 race_markers 是按内部 _id 存的（客户端 markEvent 写的是 userInfo._id），
// 可传上来的很可能是 openid——只认一种就查不到，
// 表现出来就是：明明关注过这场赛事，却被判「先关注这场赛事才能发布互助」。
// getRaceEvents 里早就踩过同一个坑（会把 openid 换算成内部 _id），这里也这么办：
// 同一个人的两种身份都算上，谁命中算谁。
async function resolveUserIds(...rawIds) {
  const ids = [];
  const push = (v) => { if (v) ids.push(v); };
  for (const id of rawIds) {
    push(id);
    try {
      if (typeof id === 'string' && id.startsWith('o')) {
        // openid → 内部 _id
        const r = await db.collection('users').where({ _openid: id }).limit(1).get();
        if (r.data && r.data[0] && r.data[0]._id) push(r.data[0]._id);
      } else if (id) {
        // 内部 _id → openid
        const r = await db.collection('users').doc(id).get().catch(() => null);
        const u = r && r.data;
        if (u && u._openid) push(u._openid);
      }
    } catch (e) { /* 查不到就用原值试，别牵连主流程 */ }
  }
  const uniq = Array.from(new Set(ids.filter(Boolean)));
  return uniq.length > 1 ? _.in(uniq) : uniq[0];
}

exports.main = async (event) => {
  const { eventId, userId, includeDrafts } = event;
  if (!eventId) return { error: '缺少 eventId' };

  // 1. 查赛事
  const evtRes = await db.collection('race_events').doc(eventId).get();
  const evt = evtRes.data;
  if (!evt) return { error: '赛事不存在' };
  // 草稿仅管理员（includeDrafts）可见，用户端视为不存在
  if (evt.publishStatus === 'draft' && !includeDrafts) {
    return { error: '赛事不存在' };
  }

  // 2. 查同 raceGroup 的评分统计
  const raceGroup = evt.raceGroup;
  let reviewStats = { count: 0, avgScore: 0, dimensions: {}, tagStats: {} };
  let groupEventIds = [eventId];

  if (raceGroup) {
    const grpRes = await db.collection('race_events').where({ raceGroup }).get();
    groupEventIds = grpRes.data.map(e => e._id);

    // 优化：只查询需要的字段（scores, raceType, tags），减少数据传输
    const revRes = await db.collection('race_reviews')
      .where(_.or([
        { raceGroup, status: 'approved' },
        { eventId: _.in(groupEventIds), status: 'approved' }
      ]))
      .field({ scores: 1, raceType: 1, tags: 1 })  // 只取需要的字段
      .get();
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

  // 3. 查询用户标记和评价（并行执行）
  let myMarker = null;
  let myReview = null;
  if (userId) {
    try {
      // 服务端自己也认一次 openid：客户端传来的可能是 _id、可能是 openid，
      // 也可能压根对不上号，不能只指望它给什么就信什么。
      const { OPENID } = cloud.getWXContext();
      const who = await resolveUserIds(userId, OPENID);
      const [mkRes, rvRes] = await Promise.all([
        db.collection('race_markers').where({ userId: who, eventId }).limit(1).get(),
        db.collection('race_reviews').where({ userId: who, eventId }).limit(1).get(),
      ]);
      myMarker = mkRes.data[0] || null;
      myReview = rvRes.data[0] || null;
    } catch (e) { console.warn('getEventDetail user data:', e); }
  }

  return { event: evt, reviewStats, myMarker, myReview };
};
