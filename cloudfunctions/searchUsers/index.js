const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d5gy0iuiba5f9300f' });
const db = cloud.database();

exports.main = async (event) => {
  const { kw } = event || {};
  if (!kw) return { list: [] };
  const regex = db.RegExp({ regexp: kw, options: 'i' });
  const [nameRes, cityRes] = await Promise.all([
    db.collection('users').where({ nickName: regex }).limit(20).get(),
    db.collection('users').where({ city: regex }).limit(20).get(),
  ]);
  const seen = new Set();
  const list = [];
  (nameRes.data || []).forEach(u => { if (!seen.has(u._id)) { seen.add(u._id); list.push(u); } });
  (cityRes.data || []).forEach(u => { if (!seen.has(u._id)) { seen.add(u._id); list.push(u); } });
  return { list };
};
