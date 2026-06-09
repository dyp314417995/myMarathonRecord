const https = require('https');
const QWEN_KEY = process.env.QWEN_KEY || '';

exports.main = async (event) => {
  const q = event.question || '';
  const hasImage = !!event.image;

  if (!QWEN_KEY) {
    return { reply: 'AI 教练未配置，请在云函数环境变量中设置 QWEN_KEY' };
  }

  if (hasImage) {
    return await visionReply(q, event.image);
  }

  return await textReply(q);
};

function httpPost(url, body, headers) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers },
      timeout: 15000,
    }, (res) => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => resolve({ status: res.statusCode, body: chunks }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
    req.write(data);
    req.end();
  });
}

async function textReply(q) {
  try {
    const res = await httpPost(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      {
        model: 'qwen-plus',
        messages: [
          { role: 'system', content: '你是资深马拉松跑步教练，10年执教经验。回答专业、具体、实操。用中文，必要时列表。如果用户发的是跑步数据，请分析数据并给出改进建议。' },
          { role: 'user', content: q },
        ],
      },
      { 'Authorization': 'Bearer ' + QWEN_KEY }
    );
    if (res.status !== 200) return { reply: 'API 错误 ' + res.status + ': ' + res.body.slice(0, 150) };
    const data = JSON.parse(res.body);
    return { reply: data.choices[0].message.content };
  } catch (e) {
    return { reply: '调用失败: ' + e.message };
  }
}

async function visionReply(q, fileID) {
  try {
    const cloud = require('wx-server-sdk');
    cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
    const tempRes = await cloud.getTempFileURL({ fileList: [fileID] });
    const imgUrl = tempRes.fileList[0] && tempRes.fileList[0].tempFileURL;
    if (!imgUrl) return { reply: '图片加载失败' };

    const res = await httpPost(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      {
        model: 'qwen-vl-plus',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: '你是资深跑步教练。请根据这张图片给出专业跑步分析和建议。' + (q ? '用户问：' + q : '') },
            { type: 'image_url', image_url: { url: imgUrl } },
          ],
        }],
      },
      { 'Authorization': 'Bearer ' + QWEN_KEY }
    );
    if (res.status !== 200) return { reply: 'API 错误 ' + res.status + ': ' + res.body.slice(0, 150) };
    const data = JSON.parse(res.body);
    return { reply: data.choices[0].message.content };
  } catch (e) {
    return { reply: '分析失败: ' + e.message };
  }
}
