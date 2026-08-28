// 云函数：cleanupBadResults - 清理无效成绩脏数据
// 规则：
//   - users.pb10k / pbHalf / pbFull：00:00:00 / 格式非法 -> 置空；半马 <1小时、全马 <2小时 -> 置空
//   - race_records（status=finished）：result 无效（同上按 raceType 判断）-> 置空
// 用法：云开发控制台直接运行，返回清理统计
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const PAGE = 100;

/** 时间字符串转秒：非法（如 0000）/空/0秒 返回 -1 */
function toSec(t) {
  if (typeof t !== 'string') return -1;
  const p = t.split(':');
  if (p.length !== 3) return -1;
  const h = +p[0], m = +p[1], s = +p[2];
  if (!isFinite(h) || !isFinite(m) || !isFinite(s) || m > 59 || s > 59) return -1;
  const sec = h * 3600 + m * 60 + s;
  return sec > 0 ? sec : -1;
}

/** PB 字段是否有效 */
function validPB(field, t) {
  const sec = toSec(t);
  if (sec <= 0) return false;
  if (field === 'pb10k' && sec < 1680) return false;   // 10K < 28 分
  if (field === 'pbHalf' && sec < 3600) return false;  // 半马 < 1 小时
  if (field === 'pbFull' && sec < 7200) return false;  // 全马 < 2 小时
  return true;
}

/** 跑马记录成绩是否有效（按赛事类型） */
function validResult(raceType, t) {
  const sec = toSec(t);
  if (sec <= 0) return false;
  if (raceType === '10k' && sec < 1680) return false;
  if (raceType === 'half' && sec < 3600) return false;
  if (raceType === 'full' && sec < 7200) return false;
  return true;
}

/** 分页拉取全量 */
async function fetchAll(collection, cond = {}) {
  const list = [];
  let skip = 0;
  while (true) {
    const res = await db.collection(collection).where(cond).skip(skip).limit(PAGE).get();
    const arr = res.data || [];
    list.push(...arr);
    if (arr.length < PAGE) break;
    skip += PAGE;
  }
  return list;
}

exports.main = async () => {
  const report = {
    users: { scanned: 0, cleared: { pb10k: 0, pbHalf: 0, pbFull: 0 }, userCount: 0 },
    records: { scanned: 0, cleared: 0 },
    samples: { users: [], records: [] },
  };

  // 1) 清理 users 的 PB 字段
  const users = await fetchAll('users');
  report.users.scanned = users.length;
  for (const u of users) {
    const patch = {};
    ['pb10k', 'pbHalf', 'pbFull'].forEach(f => {
      if (u[f] && !validPB(f, u[f])) {
        patch[f] = '';
        report.users.cleared[f]++;
      }
    });
    if (Object.keys(patch).length) {
      await db.collection('users').doc(u._id).update({ data: patch });
      report.users.userCount++;
      if (report.samples.users.length < 20) {
        report.samples.users.push({ _id: u._id, nickName: u.nickName || '', patch });
      }
    }
  }

  // 2) 清理 race_records 的无效成绩
  const records = await fetchAll('race_records');
  report.records.scanned = records.length;
  for (const r of records) {
    if (r.status === 'finished' && r.result && !validResult(r.raceType, r.result)) {
      await db.collection('race_records').doc(r._id).update({ data: { result: '' } });
      report.records.cleared++;
      if (report.samples.records.length < 20) {
        report.samples.records.push({ _id: r._id, raceType: r.raceType || '', result: r.result, city: r.city || '' });
      }
    }
  }

  return { ok: true, report };
};
