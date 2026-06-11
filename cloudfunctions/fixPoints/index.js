const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async () => {
  const users = await db.collection('users').get();
  let fixed = 0;
  for (const u of users.data) {
    const res = await db.collection('points_records').where({ userId: u._id, status: 'approved' }).get();
    const balance = res.data.reduce((sum, r) => sum + r.points, 0);
    if (u.points !== balance) {
      await db.collection('users').doc(u._id).update({ data: { points: balance } });
      fixed++;
    }
  }
  return { fixed, total: users.data.length };
};
