const DEEPSEEK_KEY = process.env.DEEPSEEK_KEY || '';

exports.main = async (event) => {
  const q = event.question || '';
  const hasImage = !!event.image;

  if (!DEEPSEEK_KEY) return { reply: 'AI 教练未配置' };

  // DeepSeek 不支持图片，引导用户描述
  if (hasImage && !q) return { reply: '📸 收到图片！\n\n请用文字描述图片内容，我来给你专业建议。\n\n例如：「这是我的10K配速截图，平均5:30/K，心率165」' };
  if (hasImage && q) return askDeepSeek(q);

  return askDeepSeek(q);
};

async function askDeepSeek(q) {
  try {
    const fetch = require('node-fetch');
    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + DEEPSEEK_KEY },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: '你是资深马拉松跑步教练，10年执教经验。回答专业、具体、实操。用中文，必要时列表。如果用户发了跑步数据，请分析并给出改进建议。' },
          { role: 'user', content: q },
        ],
        max_tokens: 1000,
      }),
    });
    if (resp.status !== 200) {
      const err = await resp.text();
      return { reply: 'API ' + resp.status + ': ' + err.slice(0, 200), model: 'DeepSeek' };
    }
    const data = await resp.json();
    return { reply: data.choices[0].message.content, model: 'DeepSeek' };
  } catch (e) {
    return { reply: '调用失败: ' + e.message, model: '' };
  }
}
