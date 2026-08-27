// cloudfunctions/ledger - 跑步账本（个人记账）
// action: list / add / update / remove / detail，数据按 OPENID 隔离
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const PAGE = 100; // 服务端单次查询上限
const COLL = 'ledger';
const BIG_CATS = ['daily', 'race'];
const MAX_IMAGES = 3;

function openid() {
  const ctx = cloud.getWXContext();
  return ctx.OPENID || '';
}

function todayStr() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** 按条件分页拉全（个人数据量小，全量后内存汇总/分页） */
async function queryAll(cond) {
  const list = [];
  let skip = 0;
  while (true) {
    const res = await db.collection(COLL).where(cond).skip(skip).limit(PAGE).get();
    const arr = res.data || [];
    list.push(...arr);
    if (arr.length < PAGE) break;
    skip += PAGE;
  }
  return list;
}

/** 给列表项附加图片临时链接 */
async function withTempUrls(items) {
  const ids = [];
  items.forEach(it => (it.images || []).forEach(fid => ids.push(fid)));
  const map = {};
  if (ids.length) {
    const uniq = [...new Set(ids)];
    try {
      const res = await cloud.getTempFileURL({ fileList: uniq });
      (res.fileList || []).forEach(f => { if (f.tempFileURL) map[f.fileID] = f.tempFileURL; });
    } catch (e) { console.warn('getTempFileURL fail', e); }
  }
  return items.map(it => ({
    ...it,
    _imageUrls: (it.images || []).map(fid => map[fid]).filter(Boolean),
  }));
}

async function list(event, uid) {
  const cond = { userId: uid };
  if (event.entryType === 'income') cond.entryType = 'income';
  else if (event.entryType === 'expense') cond.entryType = _.or([{ entryType: 'expense' }, { entryType: _.exists(false) }]);
  if (event.startDate || event.endDate) {
    if (event.startDate && event.endDate) cond.date = _.gte(event.startDate).and(_.lte(event.endDate));
    else if (event.startDate) cond.date = _.gte(event.startDate);
    else cond.date = _.lte(event.endDate);
  }

  const all = await queryAll(cond);

  // 可用小类（按大类，供筛选 chips；静态顺序优先，自定义追加）
  const staticOrder = ['跑鞋', '衣服', '买补给', '手表', '耳机', '眼镜', '补给品', '吃喝', '纪念品', '报名费', '交通', '住宿', '旅行', '钞能力名额', '其他'];
  const byBig = { daily: [], race: [] };
  all.forEach(r => {
    const arr = byBig[r.bigCategory];
    if (arr && r.smallCategory && !arr.includes(r.smallCategory)) arr.push(r.smallCategory);
  });
  const sortSmalls = arr => arr.slice().sort((a, b) => {
    const ia = staticOrder.indexOf(a);
    const ib = staticOrder.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const smallCatsByBig = { daily: sortSmalls(byBig.daily), race: sortSmalls(byBig.race) };

  // 大类/小类多选过滤：bigs 为空=不过滤大类；小类未选=该大类全选
  const bigs = Array.isArray(event.bigs) ? event.bigs.filter(b => BIG_CATS.includes(b)) : [];
  const smalls = (event.smalls && typeof event.smalls === 'object') ? event.smalls : {};
  let filtered = all;
  if (bigs.length) {
    filtered = filtered.filter(r => {
      if (!bigs.includes(r.bigCategory)) return false;
      const arr = smalls[r.bigCategory];
      if (!Array.isArray(arr) || !arr.length) return true;
      return arr.includes(r.smallCategory);
    });
  }

  filtered.sort((a, b) => (b.date || '').localeCompare(a.date || '') || ((b.createTime || 0) - (a.createTime || 0)));

  const total = filtered.length;
  const expenseSum = round2(filtered.filter(r => r.entryType !== 'income').reduce((s, r) => s + (r.amount || 0), 0));
  const dailySum = round2(filtered.filter(r => r.bigCategory === 'daily').reduce((s, r) => s + (r.amount || 0), 0));
  const raceSum = round2(filtered.filter(r => r.bigCategory === 'race').reduce((s, r) => s + (r.amount || 0), 0));
  const incomeSum = round2(filtered.filter(r => r.entryType === 'income').reduce((s, r) => s + (r.amount || 0), 0));

  const page = parseInt(event.page, 10) || 1;
  const pageSize = parseInt(event.pageSize, 10) || 20;
  const start = (page - 1) * pageSize;
  const pageItems = filtered.slice(start, start + pageSize);
  const listWithUrls = await withTempUrls(pageItems);

  return {
    ok: true,
    list: listWithUrls,
    total, expenseSum, dailySum, raceSum, incomeSum, smallCatsByBig,
    hasMore: start + pageSize < total,
    page, pageSize,
  };
}

async function add(event, uid) {
  const amount = round2(event.amount);
  if (!(amount > 0)) return { ok: false, msg: '金额必须大于 0' };
  const entryType = event.entryType === 'income' ? 'income' : 'expense';
  const images = Array.isArray(event.images)
    ? event.images.slice(0, MAX_IMAGES).filter(f => typeof f === 'string' && f.startsWith('cloud://'))
    : [];
  const date = /^\d{4}-\d{2}-\d{2}$/.test(event.date || '') ? event.date : todayStr();
  const note = String(event.note || '').trim().slice(0, 200);
  const now = new Date();

  const data = { userId: uid, entryType, amount, note, images, date, createTime: now, updateTime: now };
  if (entryType === 'income') {
    // 收入：不分大类小类，内置收入类型
    data.incomeType = String(event.incomeType || '').trim().slice(0, 20) || '比赛奖金';
  } else {
    if (!BIG_CATS.includes(event.bigCategory)) return { ok: false, msg: '大类不正确' };
    const smallCategory = String(event.smallCategory || '').trim();
    if (!smallCategory) return { ok: false, msg: '请选择小类' };
    data.bigCategory = event.bigCategory;
    data.smallCategory = smallCategory;
    data.eventName = String(event.eventName || '').trim().slice(0, 50);
    data.eventId = String(event.eventId || '').trim().slice(0, 64);
  }
  const res = await db.collection(COLL).add({ data });
  return { ok: true, id: res._id };
}

async function update(event, uid) {
  const id = event.id;
  if (!id) return { ok: false, msg: '缺少记录 ID' };
  const doc = await db.collection(COLL).doc(id).get().catch(() => null);
  if (!doc || !doc.data || doc.data.userId !== uid) return { ok: false, msg: '无权操作' };

  const patch = { updateTime: new Date() };
  if (event.amount != null) {
    const amount = round2(event.amount);
    if (!(amount > 0)) return { ok: false, msg: '金额必须大于 0' };
    patch.amount = amount;
  }
  if (event.bigCategory) {
    if (!BIG_CATS.includes(event.bigCategory)) return { ok: false, msg: '大类不正确' };
    patch.bigCategory = event.bigCategory;
  }
  if (event.smallCategory != null) patch.smallCategory = String(event.smallCategory).trim();
  if (event.date) patch.date = /^\d{4}-\d{2}-\d{2}$/.test(event.date) ? event.date : doc.data.date;
  if (event.note != null) patch.note = String(event.note).trim().slice(0, 200);
  if (event.entryType != null) {
    const et = event.entryType === 'income' ? 'income' : 'expense';
    patch.entryType = et;
    if (et === 'income') { patch.bigCategory = ''; patch.smallCategory = ''; patch.eventName = ''; patch.eventId = ''; }
    else { patch.incomeType = ''; }
  }
  if (event.incomeType != null) patch.incomeType = String(event.incomeType).trim().slice(0, 20);
  if (event.eventName != null) patch.eventName = String(event.eventName).trim().slice(0, 50);
  if (event.eventId != null) patch.eventId = String(event.eventId).trim().slice(0, 64);
  if (Array.isArray(event.images)) {
    patch.images = event.images.slice(0, MAX_IMAGES).filter(f => typeof f === 'string' && f.startsWith('cloud://'));
  }
  await db.collection(COLL).doc(id).update({ data: patch });
  return { ok: true };
}

async function remove(event, uid) {
  const id = event.id;
  if (!id) return { ok: false, msg: '缺少记录 ID' };
  const doc = await db.collection(COLL).doc(id).get().catch(() => null);
  if (!doc || !doc.data || doc.data.userId !== uid) return { ok: false, msg: '无权操作' };
  await db.collection(COLL).doc(id).remove();
  return { ok: true, images: doc.data.images || [] };
}

async function detail(event, uid) {
  const id = event.id;
  if (!id) return { ok: false, msg: '缺少记录 ID' };
  const doc = await db.collection(COLL).doc(id).get().catch(() => null);
  if (!doc || !doc.data || doc.data.userId !== uid) return { ok: false, msg: '无权查看' };
  const [item] = await withTempUrls([doc.data]);
  return { ok: true, item };
}


/** 我的赛事（已标记）列表，供比赛开支选择赛事 */
async function myRaces(event, uid) {
  // 优先按 openid 反查内部 _id；兼容客户端直接传 userId（内部 _id）兜底
  let internalId = '';
  const ures = await db.collection('users').where({ _openid: uid }).limit(1).get();
  if (ures.data[0]) internalId = ures.data[0]._id;
  if (!internalId && event.userId) internalId = event.userId;
  if (!internalId) return { ok: true, list: [] };
  const mk = await db.collection('race_markers').where({ userId: internalId }).get();
  const ids = (mk.data || []).map(m => m.eventId).filter(Boolean).slice(0, 100);
  if (!ids.length) return { ok: true, list: [] };
  const ev = await db.collection('race_events').where({ _id: _.in(ids) }).get();
  const list = (ev.data || [])
    .map(r => ({ _id: r._id, name: r.name || '未命名赛事', date: r.date }))
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  return { ok: true, list };
}

/** 确保 ledger 集合存在（不存在则自动创建，避免首次查询报错） */
async function ensureCollection() {
  try {
    await db.createCollection(COLL);
  } catch (e) {
    // 已存在或无权限创建时忽略
  }
}

exports.main = async (event = {}) => {
  const uid = openid();
  if (!uid) return { ok: false, msg: '未登录' };
  await ensureCollection();
  const { action } = event;
  try {
    switch (action) {
      case 'list': return await list(event, uid);
      case 'add': return await add(event, uid);
      case 'update': return await update(event, uid);
      case 'remove': return await remove(event, uid);
      case 'detail': return await detail(event, uid);
      case 'myRaces': return await myRaces(event, uid);
      default: return { ok: false, msg: '未知操作' };
    }
  } catch (e) {
    console.error('ledger error', action, e);
    return { ok: false, msg: '操作失败，请重试', errMsg: (e && e.message) || String(e) };
  }
};