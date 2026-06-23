// cloudfunctions/updateRaceStatus/index.js
// 定时触发器：每天凌晨自动将已过期的赛事状态改为 finished
const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();

exports.main = async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const res = await db.collection('race_events')
    .where({ status: 'upcoming', date: db.command.lt(today) })
    .get();

  let updated = 0;
  for (const r of res.data) {
    await db.collection('race_events').doc(r._id).update({
      data: { status: 'finished' }
    });
    updated++;
  }

  return { updated };
};
