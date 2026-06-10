const QWEN_KEY = process.env.QWEN_KEY || '';
const DEEPSEEK_KEY = process.env.DEEPSEEK_KEY || '';

exports.main = async (event) => {
  const q = event.question || '';
  const hasImage = !!event.image;
  const model = event.model || (QWEN_KEY ? 'qwen' : 'ds');

  if (hasImage && model === 'qwen' && QWEN_KEY) return visionQW(q, event.image);
  if (hasImage) return { reply: '图片分析仅支持千问模型', model: '' };

  if (model === 'ds' && DEEPSEEK_KEY) return textDS(q);
  if (model === 'ds') return { reply: 'DeepSeek 未配置', model: '' };
  if (QWEN_KEY) return textQW(q);
  return { reply: '千问未配置', model: '' };
};

async function textQW(q) {
  try {
    const fetch = require('node-fetch');
    const resp = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + QWEN_KEY },
      body: JSON.stringify({
        model: 'qwen-plus',
        messages: [
          { role: 'system', content: '你是资深马拉松跑步教练，回答专业具体。用中文。' },
          { role: 'user', content: q },
        ],
      }),
    });
    if (resp.status !== 200) {
      const err = await resp.text();
      return { reply: '千问 ' + resp.status + ': ' + err.slice(0, 200), model: '千问' };
    }
    const data = await resp.json();
    return { reply: data.choices[0].message.content, model: '千问' };
  } catch (e) {
    return { reply: '千问失败: ' + e.message, model: '千问' };
  }
}

async function textDS(q) {
  try {
    const fetch = require('node-fetch');
    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + DEEPSEEK_KEY },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: '你是资深马拉松跑步教练，回答专业具体。用中文。' },
          { role: 'user', content: q },
        ],
        max_tokens: 1000,
      }),
    });
    if (resp.status !== 200) {
      const err = await resp.text();
      return { reply: 'DeepSeek ' + resp.status + ': ' + err.slice(0, 200), model: 'DeepSeek' };
    }
    const data = await resp.json();
    return { reply: data.choices[0].message.content, model: 'DeepSeek' };
  } catch (e) {
    return { reply: 'DeepSeek 失败: ' + e.message, model: 'DeepSeek' };
  }
}

async function visionQW(q, fileID) {
  try {
    const cloud = require('wx-server-sdk');
    cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
    const tempRes = await cloud.getTempFileURL({ fileList: [fileID] });
    const imgUrl = tempRes.fileList[0]?.tempFileURL;
    if (!imgUrl) return { reply: '图片加载失败' };

    const fetch = require('node-fetch');
    const resp = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + QWEN_KEY },
      body: JSON.stringify({
        model: 'qwen-vl-plus',
        messages: [{ role: 'user', content: [
          { type: 'text', text: '你是跑步教练。分析图片给建议。' + (q ? '用户问：' + q : '') },
          { type: 'image_url', image_url: { url: imgUrl } },
        ]}],
      }),
    });
    if (resp.status !== 200) {
      const err = await resp.text();
      return { reply: '千问图片 ' + resp.status + ': ' + err.slice(0, 150), model: '千问' };
    }
    const data = await resp.json();
    return { reply: data.choices[0].message.content, model: '千问' };
  } catch (e) {
    return { reply: '图片分析失败: ' + e.message, model: '' };
  }
}
