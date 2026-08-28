const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d5gy0iuiba5f9300f' });
const db = cloud.database();

const PB_FIELDS = ['pb10k', 'pbHalf', 'pbFull'];

/** 时间字符串转秒：非法（如 0000）/空/0秒 返回 -1，视为无成绩 */
function toSec(t) {
  if (typeof t !== 'string') return -1;
  const p = t.split(':');
  if (p.length !== 3) return -1;
  const h = +p[0], m = +p[1], s = +p[2];
  if (!isFinite(h) || !isFinite(m) || !isFinite(s) || m > 59 || s > 59) return -1;
  const sec = h * 3600 + m * 60 + s;
  return sec > 0 ? sec : -1;
}

exports.main = async (event) => {
  const { kw = '', sortBy = 'time', sortAsc = false, page = 1, pageSize = 20 } = event || {};

  // 拉取数据：有关键字按昵称/城市检索，否则分批拉取全量（无硬性上限）
  let list = [];
  if (kw) {
    const regex = db.RegExp({ regexp: kw, options: 'i' });
    const [nameRes, cityRes] = await Promise.all([
      db.collection('users').where({ nickName: regex }).limit(100).get(),
      db.collection('users').where({ city: regex }).limit(100).get(),
    ]);
    const seen = new Set();
    (nameRes.data || []).forEach(u => { if (!seen.has(u._id)) { seen.add(u._id); list.push(u); } });
    (cityRes.data || []).forEach(u => { if (!seen.has(u._id)) { seen.add(u._id); list.push(u); } });
  } else {
    let skip = 0;
    while (true) {
      const res = await db.collection('users').skip(skip).limit(100).get();
      const arr = res.data || [];
      list.push(...arr);
      if (arr.length < 100) break;
      skip += 100;
    }
  }

  // 全局排序：没成绩/无效成绩（如 0000）恒排最后，不参与排名
  list.sort((a, b) => {
    if (sortBy === 'name') {
      return sortAsc ? (a.nickName || '').localeCompare(b.nickName || '') : (b.nickName || '').localeCompare(a.nickName || '');
    }
    if (PB_FIELDS.includes(sortBy)) {
      const minSec = { pb10k: 1680, pbHalf: 3600, pbFull: 7200 }[sortBy] || 0; // 10K≥28分/半马≥1h/全马≥2h
      const sa = toSec(a[sortBy]), sb = toSec(b[sortBy]);
      const ha = sa >= minSec, hb = sb >= minSec;
      if (ha !== hb) return ha ? -1 : 1;
      if (!ha) return (b.createTime || 0) - (a.createTime || 0) || (a._id || '').localeCompare(b._id || '');
      if (sa !== sb) return sortAsc ? sa - sb : sb - sa;
      return (a._id || '').localeCompare(b._id || '');
    }
    return sortAsc
      ? (a.createTime || 0) - (b.createTime || 0)
      : (b.createTime || 0) - (a.createTime || 0);
  });

  // 服务端分页
  const total = list.length;
  const start = (page - 1) * pageSize;
  const pageList = list.slice(start, start + pageSize);
  return { list: pageList, total, page, pageSize, hasMore: start + pageSize < total };
};
