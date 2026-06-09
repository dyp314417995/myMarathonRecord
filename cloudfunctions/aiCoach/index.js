const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const API_KEY = process.env.DEEPSEEK_KEY || '';

exports.main = async (event) => {
  const q = event.question || '';
  const hasImage = !!event.image;
  const deepMode = !!event.deepMode;

  if ((deepMode || hasImage) && API_KEY) {
    return hasImage ? await visionReply(q, event.image) : await deepReply(q);
  }
  if ((deepMode || hasImage) && !API_KEY) {
    return { reply: '需要 API Key，请在云函数环境变量中设置 DEEPSEEK_KEY' };
  }

  return { reply: kbReply(q), hasDeep: true };
};

// ========== DeepSeek 深度回答 ==========
async function deepReply(q) {
  try {
    const fetch = require('node-fetch');
    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + API_KEY },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: '你是资深马拉松教练，10年执教经验。回答专业、具体、实操。用中文，必要时列表。' },
          { role: 'user', content: q },
        ],
        max_tokens: 1000,
      }),
    });
    if (resp.status !== 200) {
      const errText = await resp.text();
      return { reply: 'API错误' + resp.status + ': ' + errText.slice(0, 150), hasDeep: true };
    }
    const data = await resp.json();
    if (!data.choices || !data.choices[0]) {
      return { reply: 'API返回异常: ' + JSON.stringify(data).slice(0, 200), hasDeep: true };
    }
    return { reply: data.choices[0].message.content };
  } catch (e) {
    return { reply: '调用失败: ' + e.message, hasDeep: true };
  }
}

// ========== DeepSeek 视觉 ==========
async function visionReply(q, fileID) {
  try {
    const tempRes = await cloud.getTempFileURL({ fileList: [fileID] });
    const imgUrl = tempRes.fileList[0] && tempRes.fileList[0].tempFileURL;
    if (!imgUrl) return { reply: '图片加载失败' };

    const fetch = require('node-fetch');
    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + API_KEY },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: '你是资深跑步教练。根据图片给专业建议。' + (q ? '用户问：' + q : '') },
            { type: 'image_url', image_url: { url: imgUrl } },
          ],
        }],
        max_tokens: 800,
      }),
    });
    if (resp.status !== 200) {
      const errText = await resp.text();
      return { reply: 'API错误' + resp.status + ': ' + errText.slice(0, 150) };
    }
    const data = await resp.json();
    return { reply: data.choices[0].message.content };
  } catch (e) {
    return { reply: '分析失败: ' + e.message };
  }
}

// ========== 知识库 ==========
function kbReply(q) {
  q = q.toLowerCase();
  const kb = [
    { kw: ['新手','开始','入门','怎么跑','刚开始'], r: '新手建议从**跑走结合**开始：\n1. 第一周：跑1分钟+走2分钟，循环10次\n2. 第二周：跑2分钟+走1分钟\n3. 第三周：连续跑5分钟\n4. 一个月后挑战5K\n🎯 目标：每周跑3次，别天天跑！' },
    { kw: ['半马','半程','21','比赛前','赛前'], r: '半马前两周策略：\n1. **减量不减质**：跑量降到平时的60%\n2. 最后一周只做短距离（5-8K）保持感觉\n3. 赛前3天多吃碳水（米面）\n4. 比赛当天早饭提前2小时吃完\n5. 起跑别冲太快，前5K配速慢15秒\n🏅 享受比赛！' },
    { kw: ['腿疼','膝盖','受伤','疼','痛'], r: '跑完腿疼分几种：\n1. **肌肉酸痛**（正常）：拉伸+泡沫轴放松，2-3天恢复\n2. **关节疼痛**（⚠️）：立即停跑，冰敷15分钟\n3. **胫骨痛**：减少跑量，换软底鞋\n4. **跟腱痛**：多提踵练习\n🩺 持续超过3天的疼痛建议看医生！' },
    { kw: ['提速','10k','万米','10公里','配速','pb','快'], r: '提升10K速度：\n1. **间歇跑**：400米快跑+200米慢走 x 8组\n2. **节奏跑**：比目标配速慢10秒跑20分钟\n3. **长距离**：每周一次12-15K慢跑\n4. **力量训练**：深蹲、弓步每周2次\n📊 坚持6周可提升1-3分钟！' },
    { kw: ['吃','饮食','补给','比赛当天','能量胶','早饭'], r: '跑步饮食指南：\n• 赛前3天碳水量占70%\n• 比赛当天2小时前吃吐司+香蕉\n• 起跑前30分钟半根能量胶\n• 每5K补一小口水\n• 别和运动饮料混喝能量胶\n🍌 不要尝试没吃过的东西！' },
    { kw: ['步频','步幅','姿势','跑姿','技术'], r: '理想步频：**170-180步/分钟**\n• 脚落在身体正下方\n• 身体微前倾，核心收紧\n• 手臂前后摆，不要交叉\n👟 高步频=低受伤风险！' },
    { kw: ['拉伸','热身','放松','准备活动'], r: '🏃 跑前动态热身5分钟：高抬腿/后踢臀/侧弓步/开合跳\n🏃 跑后静态拉伸5分钟：大腿前后侧、小腿、髋部各30秒\n别跳过拉伸！' },
    { kw: ['全马','马拉松','42','首马'], r: '首次全马备赛（16周）：\n1. 前提：轻松跑完半马\n2. 每周长距离从15K加到32K\n3. 赛前3周减量（30K→20K→10K）\n4. 全程配速比半马慢30-40秒/K\n5. 30K后才是真正的比赛\n⚠️ 前慢后快比前快后慢好太多！' },
    { kw: ['计划','训练计划','每周','日常'], r: '一周训练参考：\n📅 周一：休息或轻松5K\n📅 周二：间歇（8x400米）\n📅 周三：轻松8K\n📅 周四：节奏跑6K\n📅 周五：休息\n📅 周六：长距离15K\n📅 周日：交叉训练（游泳/骑车）\n新手去掉高强度，全换轻松跑。' },
  ];
  let best = { r: '问点训练、配速、饮食、伤病相关的吧！🏃‍♂️', score: 0 };
  for (const item of kb) {
    let score = 0;
    for (const k of item.kw) if (q.includes(k)) score++;
    if (score > best.score) best = { r: item.r, score };
  }
  return best.r;
}
