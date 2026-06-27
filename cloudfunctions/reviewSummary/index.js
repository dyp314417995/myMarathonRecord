// 云函数 reviewSummary - 每日自动总结赛事评价并存入数据库
const cloud = require('wx-server-sdk');
const fetch = require('node-fetch');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const QWEN_KEY = process.env.QWEN_KEY || '';
const DEEPSEEK_KEY = process.env.DEEPSEEK_KEY || '';

exports.main = async (event) => {
  if (event && event.eventId) return await summarizeOne(event.eventId);

  try {
    const reviewsRes = await db.collection('race_reviews').get();
    const eventIds = [...new Set(reviewsRes.data.map(r => r.eventId))];
    const results = [];
    for (const id of eventIds) {
      const r = await summarizeOne(id);
      results.push(r);
    }
    return { success: true, processed: results.length, results };
  } catch (err) {
    console.error('reviewSummary error:', err);
    return { success: false, error: err.message };
  }
};

async function summarizeOne(eventId) {
  try {
    const res = await db.collection('race_reviews').where({ eventId }).get();
    const reviews = res.data;
    if (!reviews.length) return { eventId, status: 'no_reviews' };

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
    await db.collection('race_events').doc(eventId).update({ data: { aiSummary: summary } });
    return { eventId, status: 'ok', summary };
  } catch (err) {
    return { eventId, status: 'error', error: err.message };
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
