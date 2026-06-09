const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async () => {
  const r = await db.collection('users').get();
  let n = 0;
  for (const u of r.data) {
    if (u.points === undefined) {
      await db.collection('users').doc(u._id).update({ data: { points: 50 } });
      n++;
    }
  }
  return { fixed: n, total: r.data.length };
};
