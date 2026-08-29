// cloudfunctions/getRaceEvents/index.js - 分页查询赛事（优化版）
// 优化：筛选条件推送到DB、使用预计算评分字段、去掉N+1 review聚合、合并用户状态查询
//
// 需要在 TCB 控制台创建的数据库索引：
//   race_events:   { date: -1 }                         → 索引名: idx_date_desc               → orderBy 排序
//   race_events:   { raceGroup: 1 }                      → 索引名: idx_raceGroup               → getEventDetail 同组查询
//   race_reviews:  { eventId: 1, status: 1 }             → 索引名: idx_eventId_status          → 赛事评价查询
//   race_reviews:  { userId: 1, eventId: 1 }             → 索引名: idx_userId_eventId          → 用户评价查询
//   race_reviews:  { raceGroup: 1, status: 1 }           → 索引名: idx_raceGroup_status        → 赛事组评价聚合
//   race_markers:  { eventId: 1 }                        → 索引名: idx_eventId                 → 标记人数统计
//   race_markers:  { userId: 1, eventId: 1 }             → 索引名: idx_userId_eventId          → 用户标记查询
//
// 创建方式：TCB 控制台 → 数据库 → 对应集合 → 索引 → 新建
const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { skip = 0, limit = 20, search, dateFrom, dateTo, raceType, raceLevel, raceLabel, userId, publishFilter = 'published', sortBy = 'date', action } = event || {};
  const wxContext = cloud.getWXContext();
  // ===== action: 同步/回填标记人数（markerCount 预计算字段，热度排序用） =====
  if (action === 'syncMarkerCount') {
    const { eventId } = event || {};
    if (!eventId) return { error: '缺少 eventId' };
    const cntRes = await db.collection('race_markers').where({ eventId }).count();
    await db.collection('race_events').doc(eventId).update({
      data: { markerCount: cntRes.total, updateTime: new Date() }
    });
    return { ok: true, eventId, markerCount: cntRes.total };
  }

  // 全量回填：每次处理 batchSize 条（可重复调用直到 done）
  if (action === 'syncAllMarkerCounts') {
    const batchSize = parseInt(event.batchSize, 10) > 0 ? parseInt(event.batchSize, 10) : 100;
    const skipAll = parseInt(event.skip, 10) > 0 ? parseInt(event.skip, 10) : 0;
    const evtRes = await db.collection('race_events').skip(skipAll).limit(batchSize).get();
    const evts = evtRes.data;
    let updated = 0;
    for (const e of evts) {
      try {
        const cnt = await db.collection('race_markers').where({ eventId: e._id }).count();
        await db.collection('race_events').doc(e._id).update({ data: { markerCount: cnt.total } });
        updated++;
      } catch (err) { console.warn('sync markerCount failed', e._id, err.message); }
    }
    return { ok: true, updated, processed: evts.length, nextSkip: skipAll + evts.length, done: evts.length < batchSize };
  }

  // 查询导入/更新日志（管理端日志管理 Tab）
  if (action === 'logs') {
    const { type = 'import', skip = 0, limit = 20 } = event || {};
    const col = type === 'update' ? 'race_import_log' : 'race_fetch_log';
    const res = await db.collection(col).orderBy('createTime', 'desc').skip(skip).limit(limit).get();
    const countRes = await db.collection(col).count();
    return { list: res.data.map(x => ({ ...x, _type: type === 'update' ? 'update' : 'import' })), total: countRes.total, hasMore: skip + res.data.length < countRes.total };
  }

  // 一次性：把所有草稿(publishStatus='draft')升级为已发布（方案B：信任表格，不再有草稿）
  if (action === 'publishAllDrafts') {
    const batchSize = parseInt(event.batchSize, 10) > 0 ? parseInt(event.batchSize, 10) : 100;
    const skipAll = parseInt(event.skip, 10) > 0 ? parseInt(event.skip, 10) : 0;
    const drRes = await db.collection('race_events').where({ publishStatus: 'draft' }).skip(skipAll).limit(batchSize).get();
    const drafts = drRes.data;
    let updated = 0;
    for (const d of drafts) {
      try {
        await db.collection('race_events').doc(d._id).update({ data: { publishStatus: 'published', updateTime: new Date() } });
        updated++;
      } catch (err) { console.warn('publish draft failed', d._id, err.message); }
    }
    return { ok: true, updated, processed: drafts.length, nextSkip: skipAll + drafts.length, done: drafts.length < batchSize };
  }


  // 1. 构建动态查询条件（推送到数据库层面过滤）
  const conds = [];

  if (search) {
    const regex = db.RegExp({ regexp: search, options: 'i' });
    conds.push(_.or([{ name: regex }, { city: regex }]));
  }

  // 时间范围
  const dateConds = [];
  if (dateFrom) dateConds.push(_.gte(new Date(dateFrom)));
  if (dateTo) {
    const to = new Date(dateTo);
    to.setHours(23, 59, 59, 999);
    dateConds.push(_.lte(to));
  }
  if (dateConds.length) conds.push({ date: dateConds.length === 1 ? dateConds[0] : _.and(dateConds) });

  // 赛事类型（兼容旧版 raceType 单字段）
  if (raceType) conds.push(_.or([{ raceTypes: raceType }, { raceType: raceType }]));

  // 等级/标牌
  if (raceLevel) conds.push({ raceLevel });
  if (raceLabel) conds.push({ label: raceLabel });

  // 审核状态过滤：默认仅已发布（老数据无 publishStatus 字段=视为已发布）
  if (publishFilter === 'published') {
    conds.push(_.or([{ publishStatus: 'published' }, { publishStatus: _.exists(false) }]));
  } else if (publishFilter === 'draft') {
    conds.push({ publishStatus: 'draft' });
  }
  // publishFilter='all' 不过滤（管理端看全部）

  // 全站不再做越野赛事：历史自动采集的越野数据也一并过滤
  conds.push(_.nor([{ raceTypes: 'trail' }, { raceType: 'trail' }]));

  const query = conds.length ? _.and(conds) : {};

  // 2. 查询总数 + 分页数据（一次查询）
  const ref = db.collection('race_events').where(query);
  const [countRes, dataRes] = await Promise.all([
    ref.count(),
    ref.orderBy(sortBy === 'hot' ? 'markerCount' : 'date', 'desc').skip(skip).limit(limit).get(),
  ]);
  const total = countRes.total;
  const list = dataRes.data;

  // 3. 查询标记人数（仅当前页）
  const markerCountMap = {};
  const pageEventIds = list.map(r => r._id).filter(Boolean);
  if (pageEventIds.length) {
    try {
      const mkRes = await db.collection('race_markers')
        .where({ eventId: _.in(pageEventIds) }).get();
      mkRes.data.forEach(m => { markerCountMap[m.eventId] = (markerCountMap[m.eventId] || 0) + 1; });
    } catch (e) { console.warn('getRaceEvents markers:', e); }
  }

  // 4. 查询当前页用户标记和评价状态
  let userMarkerMap = {};    // eventId -> { status, notifyEnabled, ... }
  let userReviewEventIds = new Set();

  if (userId && pageEventIds.length) {
    try {
      // 确保 userId 是 internal _id（兼容传入 _openid 的情况）
      let internalUserId = userId;
      if (typeof userId === 'string' && userId.startsWith('o')) {
        const userRes = await db.collection('users').where({ _openid: userId }).get();
        if (userRes.data[0]) internalUserId = userRes.data[0]._id;
      }

      // 并行查询用户标记和评价（仅当前页赛事）
      const [mkRes, rvRes] = await Promise.all([
        db.collection('race_markers')
          .where({ userId: internalUserId, eventId: _.in(pageEventIds) }).get(),
        db.collection('race_reviews')
          .where({ userId: internalUserId, eventId: _.in(pageEventIds) }).get(),
      ]);

      mkRes.data.forEach(m => { userMarkerMap[m.eventId] = { status: m.status, notifyEnabled: m.notifyEnabled || false }; });
      rvRes.data.forEach(r => { userReviewEventIds.add(r.eventId); });
    } catch (e) { console.warn('getRaceEvents user data:', e); }
  }

  // 5. 组装结果（使用预计算的 avgScore/reviewCount）
  const result = list.map(r => {
    const markInfo = userMarkerMap[r._id] || null;
    return {
      ...r,
      // 使用文档上预计算的评分字段（提交评价时已更新）
      avgScore: r.avgScore || 0,
      reviewCount: r.reviewCount || 0,
      markerCount: markerCountMap[r._id] || 0,
      hasReviewed: userReviewEventIds.has(r._id),
      // 用户标记信息
      myMarkInfo: markInfo,
      isMarked: !!markInfo,
      myStatus: markInfo ? markInfo.status : '',
      myNotify: markInfo ? markInfo.notifyEnabled : false,
    };
  });

  return { list: result, total, hasMore: skip + limit < total };
};
