// 云函数 getLotteries - 抽奖活动 CRUD + 抽奖码生成/验证 + 随机开奖
const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();
const _ = db.command;

function generateCode(len = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < len; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
}

function computeState(item) {
  if (item.status === 'cancelled') return { text: '已取消', cls: 'tag-red' };
  if (item.status === 'drawn') return { text: '已开奖', cls: 'tag-orange' };
  if (item.status === 'active') return { text: '进行中', cls: 'tag-green' };
  return { text: '已结束', cls: 'tag-gray' };
}

/** 计算奖品总名额 */
function totalPrizeCount(prizes) {
  return (prizes || []).reduce((s, p) => s + (parseInt(p.count) || 0), 0);
}

/** 获取用户中奖的奖品名 */
function getUserPrize(winners, userId) {
  if (!winners || !userId) return null;
  const w = winners.find(x => x.userId === userId);
  return w ? w.prizeName : null;
}

/** 执行开奖（抽选 + 分配奖品）。已通过 where 条件保证幂等 */
async function performDraw(lottery) {
  const slots = [];
  for (const p of lottery.prizes) {
    const cnt = parseInt(p.count) || 0;
    for (let i = 0; i < cnt; i++) slots.push({ prizeName: p.name });
  }
  if (!slots.length) return;

  const codeRes = await db.collection('lottery_codes')
    .where({ lotteryId: lottery._id, usedBy: _.neq(null) })
    .field({ usedBy: true })
    .limit(10000)
    .get();
  const participants = [...new Set(codeRes.data.map(c => c.usedBy))];

  let winners = [];
  if (participants.length > 0) {
    const shuffled = [...participants];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const winnerCount = Math.min(shuffled.length, slots.length);
    winners = shuffled.slice(0, winnerCount).map((uid, idx) => ({
      userId: uid, prizeName: slots[idx].prizeName,
    }));
  }

  // 条件更新：只有 status 仍为 active 时才执行，避免重复开奖
  await db.collection('lotteries')
    .where({ _id: lottery._id, status: 'active' })
    .update({ data: { status: 'drawn', winners, drawAt: db.serverDate() } });
}

/** 检查并自动开奖：status=active 且已过结束时间。开奖后同步更新 item 的内存状态 */
async function autoDrawIfExpired(item) {
  if (item.status !== 'active') return false;
  if (!item.timeEnd || new Date(item.timeEnd) >= new Date()) return false;
  await performDraw(item);
  item.status = 'drawn';
  return true;
}

exports.main = async (event) => {
  const { action, id, data, userId, codes, page, pageSize } = event || {};
  const limit = pageSize || 20;
  const skip = ((page || 1) - 1) * limit;

  // ------- 管理员：创建抽奖 + 生成抽奖码 -------
  if (action === 'create') {
    if (!data || !data.name || !data.codeCount) {
      return { error: '缺少必填项（name, codeCount）' };
    }
    const count = parseInt(data.codeCount);
    if (count < 1 || count > 10000) return { error: '抽奖码数量需在 1~10000 之间' };

    // 校验奖品
    const prizes = (data.prizes || []).filter(p => p.name && p.name.trim() && parseInt(p.count) > 0);
    if (!prizes.length) return { error: '至少设置一个奖品' };

    const doc = {
      name: data.name.trim(),
      description: data.description || '',
      timeStart: data.timeStart ? new Date(data.timeStart) : null,
      timeEnd: data.timeEnd ? new Date(data.timeEnd) : null,
      codeCount: count,
      prizes,
      winners: [],
      drawAt: null,
      images: data.images || [],
      status: 'active',
      createdBy: userId || '',
      createdAt: db.serverDate(),
    };
    const lotRes = await db.collection('lotteries').add({ data: doc });
    const lotteryId = lotRes._id;

    // 批量生成唯一抽奖码（内存中去重，避免逐码查 DB 导致超时）
    const codesSet = new Set();
    while (codesSet.size < count) {
      const code = generateCode();
      if (!codesSet.has(code)) codesSet.add(code);
    }
    const allCodes = [...codesSet].map(code => ({
      lotteryId, code, usedBy: null, usedAt: null, createdAt: db.serverDate(),
    }));
    const batchSize = 100; // 云 DB 单次 add 最多 100 条
    for (let i = 0; i < allCodes.length; i += batchSize) {
      await db.collection('lottery_codes').add({ data: allCodes.slice(i, i + batchSize) });
    }

    return { _id: lotteryId, codeCount: count, prizeCount: totalPrizeCount(prizes) };
  }

  // ------- 更新抽奖 -------
  if (action === 'update') {
    if (!id) return { error: '缺少 id' };
    const upd = { ...data };
    if (upd.timeStart) upd.timeStart = new Date(upd.timeStart);
    if (upd.timeEnd) upd.timeEnd = new Date(upd.timeEnd);
    delete upd.codeCount;
    delete upd.winners;
    delete upd.drawAt;
    await db.collection('lotteries').doc(id).update({ data: upd });
    return { success: true };
  }

  // ------- 取消抽奖 -------
  if (action === 'cancel') {
    if (!id) return { error: '缺少 id' };
    await db.collection('lotteries').doc(id).update({ data: { status: 'cancelled' } });
    return { success: true };
  }

  // ------- 开奖（随机抽选 + 分配奖品） -------
  if (action === 'draw') {
    if (!id) return { error: '缺少 id' };
    const lotRes = await db.collection('lotteries').doc(id).get();
    const lot = lotRes.data;
    if (!lot) return { error: '抽奖不存在' };
    if (lot.status !== 'active') return { error: '抽奖已结束，不能重复开奖' };
    if (!lot.prizes || !lot.prizes.length) return { error: '未设置奖品' };

    // 构建奖品槽位: [{ prizeName: '跑鞋', slot: 1 }, { prizeName: '跑鞋', slot: 2 }, ...]
    const slots = [];
    for (const p of lot.prizes) {
      const cnt = parseInt(p.count) || 0;
      for (let i = 0; i < cnt; i++) {
        slots.push({ prizeName: p.name });
      }
    }
    if (!slots.length) return { error: '奖品数量为 0' };

    // 获取所有参与用户（去重，只查 usedBy 字段）
    const codeRes = await db.collection('lottery_codes')
      .where({ lotteryId: id, usedBy: _.neq(null) })
      .field({ usedBy: true })
      .limit(10000)
      .get();
    const userSet = new Set(codeRes.data.map(c => c.usedBy));
    const participants = [...userSet];
    if (participants.length === 0) return { error: '暂无参与者' };

    // Fisher-Yates 洗牌
    const shuffled = [...participants];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    // 取 min(参与人数, 总奖品数) 个获奖者，按顺序分配奖品
    const winnerCount = Math.min(shuffled.length, slots.length);
    const selected = shuffled.slice(0, winnerCount);
    const winners = selected.map((uid, idx) => ({
      userId: uid,
      prizeName: slots[idx].prizeName,
    }));

    await db.collection('lotteries').doc(id).update({
      data: { status: 'drawn', winners, drawAt: db.serverDate() },
    });

    return { success: true, winnerCount: winners.length, participantCount: participants.length };
  }

  // ------- 删除抽奖 -------
  if (action === 'delete') {
    if (!id) return { error: '缺少 id' };
    await db.collection('lotteries').doc(id).remove();
    await db.collection('lottery_codes').where({ lotteryId: id }).remove();
    return { success: true };
  }

  // ------- 公开列表（活动广场） -------
  if (action === 'list') {
    const res = await db.collection('lotteries')
      .where({ status: _.in(['active', 'drawn']) })
      .orderBy('createdAt', 'desc')
      .skip(skip).limit(limit).get();

    const list = [];
    for (const item of res.data) {
      await autoDrawIfExpired(item);
      const usedRes = await db.collection('lottery_codes')
        .where({ lotteryId: item._id, usedBy: _.neq(null) }).count();
      const state = computeState(item);
      list.push({
        _id: item._id,
        name: item.name,
        timeStart: item.timeStart,
        timeEnd: item.timeEnd,
        codeCount: item.codeCount,
        prizes: item.prizes || [],
        winners: item.winners || [],
        drawAt: item.drawAt,
        status: item.status,
        usedCount: usedRes.total,
        stateTag: state,
        _fmtStart: fmtDate(item.timeStart),
        _fmtEnd: fmtDate(item.timeEnd),
      });
    }

    const totalRes = await db.collection('lotteries').where({ status: _.in(['active', 'drawn']) }).count();
    return { list, hasMore: skip + list.length < totalRes.total };
  }

  // ------- 用户已参与的 -------
  if (action === 'my') {
    if (!userId) return { list: [] };
    const usedRes = await db.collection('lottery_codes')
      .where({ usedBy: userId }).limit(10000).get();
    const lotteryIds = [...new Set(usedRes.data.map(c => c.lotteryId))];
    if (!lotteryIds.length) return { list: [] };

    const lotRes = await db.collection('lotteries')
      .where({ _id: _.in(lotteryIds) }).get();
    const list = [];
    for (const item of lotRes.data) {
      await autoDrawIfExpired(item);
      const state = computeState(item);
      const prizeName = getUserPrize(item.winners, userId);
      list.push({
        _id: item._id,
        name: item.name,
        status: item.status,
        codeCount: item.codeCount,
        prizes: item.prizes || [],
        stateTag: state,
        isWinner: !!prizeName,
        prizeName,
        _fmtStart: fmtDate(item.timeStart),
      });
    }
    return { list };
  }

  // ------- 详情 -------
  if (action === 'detail') {
    if (!id) return { error: '缺少 id' };
    let lotRes = await db.collection('lotteries').doc(id).get();
    let item = lotRes.data;
    if (!item) return { error: '抽奖不存在' };

    // 已过结束时间则自动开奖
    const drawn = await autoDrawIfExpired(item);
    if (drawn) {
      lotRes = await db.collection('lotteries').doc(id).get();
      item = lotRes.data;
    }

    const usedRes = await db.collection('lottery_codes')
      .where({ lotteryId: id, usedBy: _.neq(null) }).count();

    let myCodes = [];
    if (userId) {
      const myRes = await db.collection('lottery_codes')
        .where({ lotteryId: id, usedBy: userId }).get();
      myCodes = myRes.data.map(c => c.code);
    }

    const state = computeState(item);
    const prizeName = getUserPrize(item.winners, userId);

    return {
      _id: item._id,
      name: item.name,
      description: item.description,
      timeStart: item.timeStart,
      timeEnd: item.timeEnd,
      codeCount: item.codeCount,
      prizes: item.prizes || [],
      winners: item.winners || [],
      drawAt: item.drawAt,
      images: item.images,
      status: item.status,
      stateTag: state,
      usedCount: usedRes.total,
      myCodes,
      isWinner: !!prizeName,
      prizeName,
      _fmtStart: fmtDate(item.timeStart),
      _fmtEnd: fmtDate(item.timeEnd),
    };
  }

  // ------- 用户输入抽奖码 -------
  if (action === 'enter') {
    if (!id) return { error: '缺少抽奖ID' };
    if (!userId) return { error: '未登录' };
    if (!codes || !codes.length) return { error: '请输入抽奖码' };

    const lotRes = await db.collection('lotteries').doc(id).get();
    if (!lotRes.data) return { error: '抽奖不存在' };
    if (lotRes.data.status !== 'active') return { error: '抽奖已结束' };
    const now = new Date();
    if (lotRes.data.timeEnd && new Date(lotRes.data.timeEnd) < now) {
      return { error: '抽奖已结束' };
    }

    const validCodes = [];
    const invalidCodes = [];
    const alreadyUsed = [];

    for (const rawCode of codes) {
      const code = rawCode.trim().toUpperCase();
      if (!code) continue;
      const codeRes = await db.collection('lottery_codes')
        .where({ lotteryId: id, code }).get();
      if (codeRes.data.length === 0) {
        invalidCodes.push(code);
        continue;
      }
      const record = codeRes.data[0];
      if (record.usedBy && record.usedBy !== userId) {
        alreadyUsed.push(code);
        continue;
      }
      validCodes.push(code);
    }

    let successCount = 0;
    for (const code of validCodes) {
      await db.collection('lottery_codes')
        .where({ lotteryId: id, code })
        .update({ data: { usedBy: userId, usedAt: db.serverDate() } });
      successCount++;
    }

    return {
      successCount,
      invalidCodes,
      alreadyUsed,
      totalSuccess: successCount > 0,
    };
  }

  // ------- 管理员：全部抽奖 -------
  if (action === 'all') {
    const res = await db.collection('lotteries')
      .orderBy('createdAt', 'desc')
      .skip(skip).limit(limit).get();

    const list = [];
    for (const item of res.data) {
      await autoDrawIfExpired(item);
      const usedRes = await db.collection('lottery_codes')
        .where({ lotteryId: item._id, usedBy: _.neq(null) }).count();
      const state = computeState(item);
      // 按奖品汇总中奖人数
      const prizeSummary = (item.winners || []).reduce((acc, w) => {
        acc[w.prizeName] = (acc[w.prizeName] || 0) + 1;
        return acc;
      }, {});
      list.push({
        _id: item._id,
        name: item.name,
        codeCount: item.codeCount,
        prizes: item.prizes || [],
        winners: item.winners || [],
        prizeSummary,
        drawAt: item.drawAt,
        status: item.status,
        stateTag: state,
        usedCount: usedRes.total,
        createdAt: item.createdAt,
        _fmtStart: fmtDate(item.timeStart),
        _fmtEnd: fmtDate(item.timeEnd),
        _fmtCreate: fmtDate(item.createdAt),
      });
    }

    const totalRes = await db.collection('lotteries').count();
    return { list, hasMore: skip + list.length < totalRes.total };
  }

  // ------- 管理员：查看所有抽奖码 -------
  if (action === 'codes') {
    if (!id) return { error: '缺少 id' };
    const res = await db.collection('lottery_codes')
      .where({ lotteryId: id })
      .orderBy('createdAt', 'asc')
      .limit(10000)
      .get();
    const list = res.data.map(c => ({
      code: c.code,
      usedBy: c.usedBy,
      usedAt: c.usedAt ? fmtDate(c.usedAt) : null,
    }));
    return { list, total: list.length, usedCount: list.filter(c => c.usedBy).length };
  }

  return { error: '未知 action' };
};
