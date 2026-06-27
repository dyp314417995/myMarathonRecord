// cloudfunctions/checkRaceNotify - 每日检查赛事倒计时并推送通知
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 通知话术模板（接受 time 变量）
function getMsg(label, time, eventName) {
  const t = time ? `明天${time} ` : '明天';
  const templates = {
    '报名开启': {
      thing1: '报名开启提醒',
      thing2: `${t}报名开启！准备好报名资料，定好闹钟别错过`,
      thing3: '报名即将开始'
    },
    '报名截止': {
      thing1: '报名截止提醒',
      thing2: `${t}报名截止！还没报名的跑友抓紧最后机会`,
      thing3: '报名即将截止'
    },
    '退费截止': {
      thing1: '退费截止提醒',
      thing2: `${t}退费截止，需要退费请尽快操作`,
      thing3: '退费即将截止'
    },
    '出签时间': {
      thing1: '抽签结果提醒',
      thing2: `${t}公布中签结果，祝你好运！🍀`,
      thing3: '中签结果即将公布'
    },
    '缴费截止': {
      thing1: '缴费截止提醒',
      thing2: `${t}缴费截止，中签后请及时缴费锁定名额`,
      thing3: '缴费即将截止'
    },
    '候补时间': {
      thing1: '候补机会提醒',
      thing2: `${t}开启候补，还有机会！别放弃`,
      thing3: '候补即将开启'
    },
    '二抽出签': {
      thing1: '二轮抽签提醒',
      thing2: `${t}二轮抽签出结果，再试试手气！`,
      thing3: '二抽结果即将公布'
    },
    '鸣枪开跑': {
      thing1: '开赛提醒',
      thing2: `${t}鸣枪开跑！检查装备，早睡早起，加油！🏃`,
      thing3: '比赛日倒计时1天'
    }
  };
  const tmpl = templates[label];
  if (!tmpl) return null;
  return {
    thing1: tmpl.thing1,
    thing2: `${eventName} - ${tmpl.thing2}`,
    thing3: tmpl.thing3,
  };
}

exports.main = async (event, context) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

  try {
    // 1. 查询所有开启通知的标记
    const markersRes = await db.collection('race_markers')
      .where({ notifyEnabled: true })
      .get();
    const markers = markersRes.data;

    if (markers.length === 0) return { success: true, sent: 0, message: '无需要通知的用户' };

    // 2. 获取所有相关赛事
    const eventIds = [...new Set(markers.map(m => m.eventId))];
    const eventsRes = await db.collection('race_events')
      .where({ _id: db.command.in(eventIds) })
      .get();
    const eventsMap = {};
    eventsRes.data.forEach(e => { eventsMap[e._id] = e; });

    let sentCount = 0;
    const results = [];

    // 3. 遍历标记，检查时间节点
    for (const marker of markers) {
      const event = eventsMap[marker.eventId];
      if (!event || !event.timeline || !event.timeline.length) continue;

      // 找明天到期的节点
      for (const node of event.timeline) {
        if (!node.date) continue;
        const nodeDateStr = typeof node.date === 'string'
          ? node.date.substring(0, 10)
          : `${node.date.getFullYear()}-${String(node.date.getMonth() + 1).padStart(2, '0')}-${String(node.date.getDate()).padStart(2, '0')}`;

        if (nodeDateStr !== tomorrowStr) continue;

        const msgData = getMsg(node.label, node.time || '', event.name);
        if (!msgData) continue;

        // 4. 发送订阅消息
        try {
          // 获取用户 openid
          const userRes = await db.collection('users').doc(marker.userId).get();
          const openid = userRes.data ? userRes.data.openid : null;
          if (!openid) {
            results.push({ userId: marker.userId, eventId: event._id, label: node.label, status: 'no_openid' });
            continue;
          }

          await cloud.openapi.subscribeMessage.send({
            touser: openid,
            templateId: 'xepY9QmUT4YPXUt7mLhQrtlVBcN01eGkk-NqH0Av5Ew',
            page: `/pages/tools/calendar/detail?id=${event._id}`,
            data: {
              thing1: { value: msgData.thing1 },
              thing2: { value: msgData.thing2 },
              thing3: { value: msgData.thing3 },
            }
          });
          sentCount++;
          results.push({ userId: marker.userId, eventId: event._id, label: node.label, status: 'sent' });
        } catch (err) {
          results.push({ userId: marker.userId, eventId: event._id, label: node.label, status: 'fail', error: err.message });
        }
      }
    }

    return { success: true, sent: sentCount, results };
  } catch (err) {
    console.error('checkRaceNotify error:', err);
    return { success: false, error: err.message };
  }
};
