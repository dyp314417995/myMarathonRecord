// 云函数 checkAiSummary - 诊断 aiSummary 数据状态
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const eventId = event.eventId;
  if (!eventId) return { error: '缺少 eventId' };

  // 1. 查 race_events
  const evt = await db.collection('race_events').doc(eventId).get();
  const evtData = evt.data || {};

  // 2. 查同 raceGroup 的赛事
  let groupEvents = [];
  if (evtData.raceGroup) {
    const grp = await db.collection('race_events').where({ raceGroup: evtData.raceGroup }).get();
    groupEvents = grp.data.map(e => ({ _id: e._id, name: e.name, aiSummary: e.aiSummary, aiSummaryAt: e.aiSummaryAt }));
  }

  // 3. 查评价数量
  const reviewCount = await db.collection('race_reviews').where({ eventId }).count();
  let groupReviewCount = 0;
  if (evtData.raceGroup) {
    const eids = groupEvents.map(e => e._id);
    const gr = await db.collection('race_reviews').where({ eventId: db.command.in(eids) }).count();
    groupReviewCount = gr.total;
  }

  return {
    event: {
      _id: evtData._id,
      name: evtData.name,
      raceGroup: evtData.raceGroup,
      aiSummary: evtData.aiSummary,
      aiSummaryAt: evtData.aiSummaryAt,
    },
    hasAiSummary: !!evtData.aiSummary,
    aiSummaryValue: evtData.aiSummary || '(空)',
    hasRaceGroup: !!evtData.raceGroup,
    groupEvents,
    reviewCount: reviewCount.total,
    groupReviewCount,
    // 总结一下
    diagnosis: !evtData.raceGroup
      ? '没有 raceGroup，reviewSummary 云函数不会为此赛事生成总评'
      : evtData.aiSummary
        ? '有 aiSummary，应该能正常显示'
        : '有 raceGroup 但 aiSummary 为空，reviewSummary 云函数可能未部署或未触发',
  };
};
