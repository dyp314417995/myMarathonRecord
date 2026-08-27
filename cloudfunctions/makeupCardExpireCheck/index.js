// cloudfunctions/makeupCardExpireCheck/index.js - 补签卡过期标记
// 定时触发器：每天 00:05 执行，扫描 expire_at 已过期且 status=0 的补签卡，标记为已过期（status=2）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

async function ensureCollections() {
  try { await db.createCollection('makeup_card'); } catch (e) { /* 已存在则忽略 */ }
}

exports.main = async () => {
  await ensureCollections();
  const now = new Date();
  let marked = 0;
  try {
    // 用 _id 游标分批处理，避免 skip 翻页在修改集合时的偏移问题
    let lastId = '';
    const BATCH = 100;
    while (true) {
      let query = { status: 0, expire_at: _.lte(now) };
      if (lastId) query._id = _.gt(lastId);
      const res = await db.collection('makeup_card')
        .where(query).orderBy('_id', 'asc').limit(BATCH).get();
      const rows = res.data || [];
      if (rows.length === 0) break;
      for (const c of rows) {
        await db.collection('makeup_card').doc(c._id).update({
          data: { status: 2 },
        });
        marked += 1;
        lastId = c._id;
      }
      if (rows.length < BATCH) break;
    }
  } catch (e) {
    console.error('makeupCardExpireCheck error', e);
    return { success: false, error: e.message, marked };
  }
  return { success: true, marked };
};