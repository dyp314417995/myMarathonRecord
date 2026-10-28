// 我的证书：把跑过的赛事证书存成一份「荣耀时刻」清单
// 证书可以关联一场已有赛事（带出名称/日期/项目/地点），也可以自己录入一场没有收录的赛事
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const COLL = 'race_certificates';

async function ensureCollection() {
  try { await db.createCollection(COLL); } catch (e) { /* 已存在 */ }
}

function openidOf() {
  const ctx = cloud.getWXContext() || {};
  return ctx.OPENID || '';
}

// race_markers / race_records 都按 users 表的内部 _id 存用户，
// 云函数里拿到的是微信 OPENID，必须先反查成内部 _id，否则「我的赛事」永远查不到
async function internalIdOf(oid) {
  if (!oid) return '';
  const r = await db.collection('users').where({ _openid: oid }).limit(1).get().catch(() => null);
  if (r && r.data && r.data[0]) return r.data[0]._id;
  return '';
}

// 赛事的 date 是 Date 类型，统一成 YYYY-MM-DD 给前端用
function fmtDate(d) {
  if (!d) return '';
  const t = new Date(d);
  if (isNaN(t.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}

// 我的证书列表（带 ?userId 时看别人的，别人看到的是只读）
async function list(event, uid) {
  const userId = event.userId || uid;
  if (!userId) return { ok: false, msg: '未登录' };
  const r = await db.collection(COLL).where({ userId })
    .orderBy('createTime', 'desc').limit(100).get().catch(() => null);
  const list = ((r && r.data) || []).map(c => ({
    ...c,
    date: c.date || '',
    images: Array.isArray(c.images) ? c.images : (c.image ? [c.image] : []),
  }));
  // 分享进来时顺带把主人昵称带上
  let ownerName = '';
  const u = await db.collection('users').where({ _id: userId }).limit(1).get().catch(() => null);
  if (u && u.data && u.data[0]) ownerName = u.data[0].nickName || u.data[0].nickname || '';
  return { ok: true, list, ownerName, mine: userId === uid };
}

// 新增证书
async function add(event, uid) {
  if (!uid) return { ok: false, msg: '未登录' };
  const name = String(event.name || '').trim();
  if (!name) return { ok: false, msg: '请填写赛事名称' };
  const images = Array.isArray(event.images) ? event.images.slice(0, 6) : [];
  if (!images.length) return { ok: false, msg: '请上传证书图片' };
  const doc = {
    userId: uid,
    eventId: String(event.eventId || ''),
    name,
    date: String(event.date || ''),
    raceType: String(event.raceType || ''),
    city: String(event.city || ''),
    result: String(event.result || ''),
    rank: String(event.rank || ''),
    note: String(event.note || ''),
    images,
    createTime: new Date(),
    updateTime: new Date(),
  };
  const r = await db.collection(COLL).add({ data: doc });
  return { ok: true, id: r._id };
}

// 编辑证书（只能改自己的）
async function update(event, uid) {
  if (!uid) return { ok: false, msg: '未登录' };
  const id = String(event.id || '');
  if (!id) return { ok: false, msg: '缺少证书' };
  const r = await db.collection(COLL).doc(id).get().catch(() => null);
  if (!r || !r.data) return { ok: false, msg: '证书不存在' };
  if (r.data.userId !== uid) return { ok: false, msg: '只能修改自己的证书' };
  const patch = { updateTime: new Date() };
  ['eventId', 'name', 'date', 'raceType', 'city', 'result', 'rank', 'note'].forEach(k => {
    if (event[k] !== undefined) patch[k] = String(event[k] || '');
  });
  if (Array.isArray(event.images)) patch.images = event.images.slice(0, 6);
  const name = String(patch.name || r.data.name || '').trim();
  if (!name) return { ok: false, msg: '请填写赛事名称' };
  patch.name = name;
  await db.collection(COLL).doc(id).update({ data: patch });
  return { ok: true };
}

// 删除证书（只能删自己的）
async function remove(event, uid) {
  if (!uid) return { ok: false, msg: '未登录' };
  const id = String(event.id || '');
  if (!id) return { ok: false, msg: '缺少证书' };
  const r = await db.collection(COLL).doc(id).get().catch(() => null);
  if (!r || !r.data) return { ok: false, msg: '证书不存在' };
  if (r.data.userId !== uid) return { ok: false, msg: '只能删除自己的证书' };
  await db.collection(COLL).doc(id).remove().catch(() => {});
  return { ok: true };
}

// 我的赛事（race_markers 里标记的），供添加证书时选择并带出赛事信息
// 成绩从两条路带出：
//   ① marker.recordId → race_records（在赛事日历里标记「已完赛」时写的那条，最准）
//   ② 兜底按赛事名匹配 race_records.city（直接在跑马记录里录的，没走日历标记）
async function myEvents(event, uid) {
  if (!uid) return { ok: false, msg: '未登录' };
  const mk = await db.collection('race_markers').where({ userId: uid }).limit(200).get().catch(() => null);
  const markers = (mk && mk.data) || [];
  const ids = [...new Set(markers.map(m => m.eventId).filter(Boolean))].slice(0, 100);
  if (!ids.length) return { ok: true, list: [] };

  // ① 按 recordId 精确关联的成绩
  const recIdByEvent = {};
  markers.forEach(m => { if (m.recordId) recIdByEvent[m.eventId] = m.recordId; });
  const rids = [...new Set(Object.values(recIdByEvent))].slice(0, 100);
  const recById = {};
  if (rids.length) {
    const rr = await db.collection('race_records').where({ _id: _.in(rids) }).limit(100).get().catch(() => null);
    ((rr && rr.data) || []).forEach(r => { recById[r._id] = r; });
  }

  // ② 本人的全部成绩记录，按赛事名兜底匹配（race_records.city 里存的是赛事名）
  const recByName = {};
  const myRec = await db.collection('race_records').where({ userId: uid }).limit(100).get().catch(() => null);
  ((myRec && myRec.data) || []).forEach(r => { if (r.city) recByName[r.city] = r; });

  const ev = await db.collection('race_events').where({ _id: _.in(ids) }).limit(100).get().catch(() => null);
  const list = ((ev && ev.data) || []).map(e => {
    const rec = (recIdByEvent[e._id] && recById[recIdByEvent[e._id]]) || recByName[e.name] || null;
    return {
      _id: e._id,
      name: e.name || '',
      date: fmtDate(e.date),
      city: [e.province, e.city].filter(Boolean).join(''),
      raceTypes: Array.isArray(e.raceTypes) ? e.raceTypes : [],
      // 成绩与项目：有成绩记录时以记录为准（那是实际跑的项目），没有就留空让人自己填
      result: rec ? String(rec.result || '') : '',
      raceType: rec ? String(rec.raceType || '') : '',
      recordDate: rec ? String(rec.date || '') : '',
      hasResult: !!(rec && rec.result),
    };
  }).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  return { ok: true, list };
}

exports.main = async (event = {}) => {
  const oid = openidOf();
  // 统一用内部 _id 作为证书归属，和赛事/成绩记录保持一致
  const uid = (await internalIdOf(oid)) || event.userId || oid;
  await ensureCollection();
  const { action } = event;
  try {
    switch (action) {
      case 'list': return await list(event, uid);
      case 'add': return await add(event, uid);
      case 'update': return await update(event, uid);
      case 'remove': return await remove(event, uid);
      case 'myEvents': return await myEvents(event, uid);
      default: return { ok: false, msg: '未知操作' };
    }
  } catch (e) {
    return { ok: false, msg: (e && e.message) || '服务异常' };
  }
};
