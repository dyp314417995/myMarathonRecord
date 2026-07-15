// 云函数 reviewSummary - 每日定时总结赛事评价（有新增才重新生成）
const cloud = require('wx-server-sdk');
const fetch = require('node-fetch');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const QWEN_KEY = process.env.QWEN_KEY || '';
const DEEPSEEK_KEY = process.env.DEEPSEEK_KEY || '';

exports.main = async (event) => {
  // 手动触发：传 eventId 或 'all'
  if (event && event.eventId && event.eventId !== 'all') {
    return await summarizeIfNeeded(event.eventId);
  }
  try {
    // 找出有评价的赛事组，按赛事组聚合
    const eventsRes = await db.collection('race_events').field({ raceGroup: true, aiSummaryAt: true }).get();
    const groups = {};
    eventsRes.data.forEach(e => {
      if (!e.raceGroup) return;
      if (!groups[e.raceGroup]) groups[e.raceGroup] = [];
      groups[e.raceGroup].push(e);
    });

    const results = [];
    for (const [raceGroup, groupEvents] of Object.entries(groups)) {
      const eventIds = groupEvents.map(e => e._id);
      // 最新总结时间（未总结过则为0）
      const times = groupEvents.map(e => e.aiSummaryAt ? new Date(e.aiSummaryAt).getTime() : 0);
      const lastAt = Math.max(...times);

      // 如果总结过，检查是否有新评价；未总结过则直接生成
      if (lastAt > 0) {
        const newCount = await db.collection('race_reviews')
          .where({ eventId: db.command.in(eventIds), createTime: db.command.gt(new Date(lastAt)) })
          .count();
        if (newCount.total === 0) {
          results.push({ raceGroup, status: 'skip', reason: '无新评价' });
          continue;
        }
      }

      const r = await summarizeGroup(raceGroup, eventIds);
      results.push(r);
    }
    return { success: true, processed: results };
  } catch (err) {
    console.error('reviewSummary error:', err);
    return { success: false, error: err.message };
  }
};

// 外部调用（详情页/管理端）
async function summarizeIfNeeded(eventId) {
  const evt = await db.collection('race_events').doc(eventId).get();
  const raceGroup = (evt.data || {}).raceGroup;
  if (!raceGroup) return { status: 'no_raceGroup' };

  const groupEvents = await db.collection('race_events').where({ raceGroup }).get();
  const eventIds = groupEvents.data.map(e => e._id);
  const times = groupEvents.data.map(e => e.aiSummaryAt ? new Date(e.aiSummaryAt).getTime() : 0);
  const lastAt = Math.max(...times);
  if (lastAt > 0) {
    const newCount = await db.collection('race_reviews')
      .where({ eventId: db.command.in(eventIds), createTime: db.command.gt(new Date(lastAt)) })
      .count();
    if (newCount.total === 0) return { status: 'skip', reason: '无新评价' };
  }

  return await summarizeGroup(raceGroup, eventIds);
}

async function summarizeGroup(raceGroup, eventIds) {
  try {
    const res = await db.collection('race_reviews').where({ eventId: db.command.in(eventIds) }).get();
    const reviews = res.data;
    if (!reviews.length) return { raceGroup, status: 'no_reviews' };

    const fullReviews = reviews.filter(r => r.raceType !== 'half');
    const halfReviews = reviews.filter(r => r.raceType === 'half');

    const parts = [];
    if (fullReviews.length) {
      const s = await genSummary(fullReviews, '全程马拉松');
      if (s) parts.push(`全马：${s}`);
    }
    if (halfReviews.length) {
      const s = await genSummary(halfReviews, '半程马拉松');
      if (s) parts.push(`半马：${s}`);
    }

    const summary = parts.join('；') || '暂无评价';
    const now = new Date();
    for (const eid of eventIds) {
      await db.collection('race_events').doc(eid).update({ data: { aiSummary: summary, aiSummaryAt: now } });
    }
    return { raceGroup, status: 'ok', summary, updated: eventIds.length };
  } catch (err) {
    return { raceGroup, status: 'error', error: err.message };
  }
}

async function genSummary(reviews, typeLabel) {
  if (!reviews.length) return '';

  const parts = reviews.slice(0, 20).map((r, i) => {
    const dims = { difficulty: '赛道', atmosphere: '氛围', supply: '补给', transport: '交通' };
    const scoreStr = Object.entries(r.scores || {}).map(([k, v]) => `${dims[k] || k}${v}分`).join('，');
    const tagStr = (r.tags || []).length ? `标签：${r.tags.join('、')}` : '';
    const descStr = r.description ? `感受：${r.description}` : '';
    return `[跑友${i + 1}] ${scoreStr}。${tagStr}${descStr ? '。' + descStr : ''}`;
  }).join('\n');

  const prompt = `你是马拉松圈内老炮，用口语化、接地气的中文总结以下${typeLabel}评价。`
    + `要像跑友闲聊一样自然，不要太官方。控制50字以内，突出大家最真实的反馈。\n\n${parts}`;

  return await callAI(prompt);
}

async function callAI(prompt) {
  if (QWEN_KEY) {
    try {
      const resp = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + QWEN_KEY },
        body: JSON.stringify({
          model: 'qwen-plus',
          messages: [
            { role: 'system', content: '你是马拉松跑友，说话接地气、口语化。回复简洁自然。' },
            { role: 'user', content: prompt }
          ],
          max_tokens: 120,
        }),
      });
      const data = await resp.json();
      if (data.choices) return data.choices[0].message.content.trim();
    } catch {}
  }
  if (DEEPSEEK_KEY) {
    try {
      const resp = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + DEEPSEEK_KEY },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: '你是马拉松跑友，说话接地气、口语化。回复简洁自然。' },
            { role: 'user', content: prompt }
          ],
          max_tokens: 120,
        }),
      });
      const data = await resp.json();
      if (data.choices) return data.choices[0].message.content.trim();
    } catch {}
  }
  return 'AI服务暂不可用';
};
