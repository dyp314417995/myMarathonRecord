// 云函数：fixPoints - 积分余额对账
// 用法：云开发控制台直接运行（不传参数 = 处理前 100 个用户）
//     用户多时分批跑：event 传 { offset: 0, limit: 100 } → { offset: 100, limit: 100 } … 直到 done 为 true
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const PAGE = 100; // 云函数端单次查询上限（默认 100），分页拉全
const BATCH = 100; // 单次运行处理的用户数（避免超时，分批跑）

/** 分页拉取用户全部已通过流水并求和 */
async function sumApprovedPoints(userId) {
  let total = 0;
  let skip = 0;
  while (true) {
    const res = await db.collection('points_records')
      .where({ userId, status: 'approved' })
      .skip(skip).limit(PAGE).get();
    const list = res.data || [];
    if (list.length === 0) break;
    total += list.reduce((s, r) => s + r.points, 0);
    if (list.length < PAGE) break;
    skip += PAGE;
  }
  return total;
}

/** 按 _id 升序分页取一批用户（保证分批处理不重不漏） */
async function getUsers(offset, limit) {
  const res = await db.collection('users')
    .orderBy('_id', 'asc')
    .skip(offset).limit(limit).get();
  return res.data || [];
}

exports.main = async (event = {}) => {
  const offset = Math.max(parseInt(event.offset, 10) || 0, 0);
  const limit = Math.min(parseInt(event.limit, 10) || BATCH, 100);

  const users = await getUsers(offset, limit);
  let fixed = 0;
  for (const u of users) {
    const balance = await sumApprovedPoints(u._id);
    if ((u.points || 0) !== balance) {
      await db.collection('users').doc(u._id).update({ data: { points: balance } });
      fixed++;
    }
  }
  return {
    ok: true,
    processed: users.length,
    fixed,
    offset,
    limit,
    nextOffset: offset + users.length,
    done: users.length < limit, // 最后一批（或已处理完）：下一轮可结束
  };
};