// 云函数 queryEvents - 按赛事名称模糊查询，用于排查数据问题
// 调用示例：{ search: "太原" }
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const search = (event.search || '').trim();
  if (!search) return { error: '缺少 search 参数' };

  const regex = db.RegExp({ regexp: search, options: 'i' });
  const res = await db.collection('race_events')
    .where(_.or([
      { name: regex },
      { city: regex },
    ]))
    .orderBy('date', 'desc')
    .get();

  const list = res.data.map(e => ({
    _id: e._id,
    name: e.name,
    date: e.date ? e.date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : null,
    city: e.city,
    province: e.province,
    raceGroup: e.raceGroup || '(空)',
    raceTypes: e.raceTypes || [e.raceType || ''],
    raceLevel: e.raceLevel,
    label: e.label,
    hasAiSummary: !!e.aiSummary,
    aiSummary: (e.aiSummary || '').slice(0, 80),
    aiSummaryAt: e.aiSummaryAt || null,
    reviewCount: e.reviewCount || 0,
    avgScore: e.avgScore || 0,
    status: e.status,
  }));

  return {
    total: list.length,
    search,
    list,
  };
};
