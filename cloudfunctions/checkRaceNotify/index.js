// cloudfunctions/checkRaceNotify - 每日检查赛事倒计时并推送通知
const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d5gy0iuiba5f9300f', traceUser: true });
const db = cloud.database();

// 通知话术模板（接受 time 变量）
function getMsg(label, time, eventName, nodeDate) {
  const ds = nodeDate ? `${nodeDate.getFullYear()}年${nodeDate.getMonth()+1}月${nodeDate.getDate()}日 ${time || '00:00'}` : '';
  const templates = {
    '报名开启': {
      date1: ds, thing2: `${eventName} 报名即将开始`, time3: ds
    },
    '报名截止': {
      date1: ds, thing2: `${eventName} 报名即将截止`, time3: ds
    },
    '退费截止': {
      date1: ds, thing2: `${eventName} 退费即将截止`, time3: ds
    },
    '出签时间': {
      date1: ds, thing2: `${eventName} 中签结果即将公布`, time3: ds
    },
    '缴费截止': {
      date1: ds, thing2: `${eventName} 请及时缴费`, time3: ds
    },
    '候补时间': {
      date1: ds, thing2: `${eventName} 候补即将开启`, time3: ds
    },
    '二抽出签': {
      date1: ds, thing2: `${eventName} 二抽结果即将公布`, time3: ds
    },
    '鸣枪开跑': {
      date1: ds, thing2: `${eventName} 明天开跑，加油！`, time3: ds
    }
  };
  const tmpl = templates[label];
  if (!tmpl) return null;
  return {
    date1: { value: tmpl.date1 },
    thing2: { value: tmpl.thing2 },
    time3: { value: tmpl.time3 },
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

      for (const node of event.timeline) {
        if (!node.date) continue;
        const nodeDateStr = typeof node.date === 'string'
          ? node.date.substring(0, 10)
          : `${node.date.getFullYear()}-${String(node.date.getMonth() + 1).padStart(2, '0')}-${String(node.date.getDate()).padStart(2, '0')}`;

        if (nodeDateStr !== tomorrowStr) continue;

        const msgData = getMsg(node.label, node.time || '', event.name, new Date(node.date));
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

          await cloud.callFunction({
            name: 'sendSubscribeMsg',
            data: {
              openid,
              templateId: 'xepY9QmUT4YPXUt7mLhQrtlVBcN01eGkk-NqH0Av5Ew',
              page: `/pages/tools/calendar/detail?id=${event._id}`,
              data: msgData,
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
