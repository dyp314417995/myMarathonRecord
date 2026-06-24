// cloudfunctions/getRaceEvents/index.js
const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();

exports.main = async () => {
  const count = await db.collection('race_events').count();
  const batchTimes = Math.ceil(count.total / 100);
  const tasks = [];
  for (let i = 0; i < batchTimes; i++) {
    tasks.push(db.collection('race_events').orderBy('date', 'asc').skip(i * 100).limit(100).get());
  }
  const results = await Promise.all(tasks);
  return results.reduce((arr, r) => arr.concat(r.data), []);
};
