// tests/raceHelp.lifecycle.test.js
// 跑友互助云函数的端到端逻辑验证：用内存数据库替掉 wx-server-sdk，
// 直接 require 线上那份 index.js（不改代码、不连环境），把整条生命周期跑一遍。
//
// 运行：node tests/raceHelp.lifecycle.test.js
//
// 覆盖：发布门槛 / 组内外可见性 / 应征满员自动完成 / 已完成退出（按完成原因分两条路）/
//       截止 / 取消 / 编辑再发起 / 删除（软删）/ 应征者删除记录 / 我的互助四态

const assert = require('assert');
const path = require('path');
const Module = require('module');

// ---------------------------------------------------------------- 内存数据库

const store = new Map();      // collectionName -> Map(id -> doc)
let seq = 0;

function coll(name) {
  if (!store.has(name)) store.set(name, new Map());
  return store.get(name);
}

function clone(v) {
  if (v instanceof Date) return new Date(v.getTime());
  if (Array.isArray(v)) return v.map(clone);
  if (v && typeof v === 'object') {
    const o = {};
    Object.keys(v).forEach(k => { o[k] = clone(v[k]); });
    return o;
  }
  return v;
}

function cmd(op, value) { return { __cmd: op, value }; }

function matchValue(actual, expect) {
  if (expect && typeof expect === 'object' && expect.__cmd) {
    const v = expect.value;
    switch (expect.__cmd) {
      case 'eq': return actual === v;
      case 'neq': return actual !== v;          // 字段不存在时也成立，跟云开发一致
      case 'gt': return actual > v;
      case 'gte': return actual >= v;
      case 'lt': return actual < v;
      case 'lte': return actual <= v;
      case 'in': return (v || []).indexOf(actual) >= 0;
      case 'nin': return (v || []).indexOf(actual) < 0;
      default: throw new Error('未实现的查询指令 ' + expect.__cmd);
    }
  }
  return actual === expect;
}

function matchDoc(doc, cond) {
  return Object.keys(cond || {}).every(k => matchValue(doc[k], cond[k]));
}

const command = {
  eq: v => cmd('eq', v),
  neq: v => cmd('neq', v),
  gt: v => cmd('gt', v),
  gte: v => cmd('gte', v),
  lt: v => cmd('lt', v),
  lte: v => cmd('lte', v),
  in: v => cmd('in', v),
  nin: v => cmd('nin', v),
};

class DocRef {
  constructor(name, id) { this.name = name; this.id = id; }
  async get() {
    const d = coll(this.name).get(this.id);
    if (!d) throw new Error('document.get:fail document does not exist');
    return { data: clone(d) };
  }
  async update({ data }) {
    const d = coll(this.name).get(this.id);
    if (!d) throw new Error('document.update:fail document does not exist');
    Object.assign(d, clone(data));
    return { stats: { updated: 1 } };
  }
}

class Query {
  constructor(name, cond = {}, orders = [], lim = 0, fields = null) {
    this.name = name; this.cond = cond; this.orders = orders; this.lim = lim; this.fields = fields;
  }
  where(cond) { return new Query(this.name, cond, this.orders, this.lim, this.fields); }
  orderBy(field, dir) { return new Query(this.name, this.cond, this.orders.concat([[field, dir]]), this.lim, this.fields); }
  limit(n) { return new Query(this.name, this.cond, this.orders, n, this.fields); }
  field(f) { return new Query(this.name, this.cond, this.orders, this.lim, f); }
  doc(id) { return new DocRef(this.name, id); }

  _rows() {
    let rows = Array.from(coll(this.name).values()).filter(d => matchDoc(d, this.cond));
    for (let i = 0; i < this.orders.length; i++) {
      const [f, dir] = this.orders[i];
      const sign = dir === 'desc' ? -1 : 1;
      rows.sort((a, b) => {
        const x = a[f], y = b[f];
        if (x === y) return 0;
        return (x > y ? 1 : -1) * sign;
      });
    }
    if (this.lim) rows = rows.slice(0, this.lim);
    return rows;
  }
  async get() {
    const rows = this._rows();
    // 简易 field 投影：只取指定字段 + _id，跟云开发行为一致
    if (!this.fields) return { data: rows.map(clone) };
    return {
      data: rows.map((r) => {
        const o = { _id: r._id };
        Object.keys(this.fields).forEach((k) => { if (this.fields[k]) o[k] = clone(r[k]); });
        return o;
      }),
    };
  }
  async count() { return { total: this._rows().length }; }
  async add({ data }) {
    const id = 'id_' + (++seq);
    coll(this.name).set(id, Object.assign(clone(data), { _id: id }));
    return { _id: id };
  }
}

// ---------------------------------------------------------------- 云开发替身

let currentOpenid = '';
const notifyCalls = [];      // 订阅消息：谁被通知了

const mockCloud = {
  DYNAMIC_CURRENT_ENV: 'test-env',
  init() {},
  getWXContext() { return { OPENID: currentOpenid }; },
  database() {
    return { command, collection: name => new Query(name) };
  },
  openapi: {
    security: {
      async msgSecCheck() { return { errCode: 0 }; },
    },
  },
  async callFunction({ name, data }) {
    if (name === 'sendSubscribeMsg') { notifyCalls.push(data); return { result: { ok: true } }; }
    return { result: {} };
  },
};

// 让 require('wx-server-sdk') 拿到上面这个替身
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') return mockCloud;
  return origLoad.apply(this, arguments);
};

const fn = require(path.join(__dirname, '..', 'cloudfunctions', 'raceHelp', 'index.js'));
assert.strictEqual(typeof fn.main, 'function', '云函数没有导出 main');

// ---------------------------------------------------------------- 测试脚手架

// 真实 openid 是 28 位的 o 开头字符串，测试数据得照着来，
// 否则「openid 直接用」那条捷径根本走不到，测出来的结论是假的
const OID = k => ('o' + k + 'X'.repeat(27)).slice(0, 28);

const USERS = {
  owner: { _id: 'u_owner', _openid: OID('owner'), nickName: '发起人' },
  a: { _id: 'u_a', _openid: OID('a'), nickName: '跑友A' },
  b: { _id: 'u_b', _openid: OID('b'), nickName: '跑友B' },
  c: { _id: 'u_c', _openid: OID('c'), nickName: '跑友C' },
};

function seed() {
  store.clear(); seq = 0; notifyCalls.length = 0;
  // 赛事本体：互助只存 eventId，聚合页要按赛事分组得靠它补名字和日期
  coll('race_events').set('E1', { _id: 'E1', name: '测试马拉松', city: '北京', date: '2026-11-08', raceTypes: ['full'] });
  Object.keys(USERS).forEach(k => {
    const u = USERS[k];
    coll('users').set(u._id, clone(u));
    // 除了跑友C，都关注了 E1（C 用来测「未关注」和「组外」）
    if (k !== 'c') coll('race_markers').set('m_' + k, { _id: 'm_' + k, userId: u._id, eventId: 'E1' });
  });
  // C 关注，但不参与互助——用来测组外可见性
  coll('race_markers').set('m_c', { _id: 'm_c', userId: 'u_c', eventId: 'E1' });
}

async function call(who, data) {
  currentOpenid = USERS[who]._openid;
  const res = await fn.main(Object.assign({ eventId: 'E1' }, data), {});
  return res || {};
}

const pad = n => String(n).padStart(2, '0');
const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const future = days => fmt(new Date(Date.now() + days * 86400000));
const past = days => fmt(new Date(Date.now() - days * 86400000));

function publish(who, over) {
  return call(who, Object.assign({
    action: 'create',
    type: 'room',
    title: '拼房找搭子',
    desc: '赛事起点附近，双床房',
    costNote: 'AA',
    peopleNeeded: 2,
    deadline: future(7),
    contact: { wechat: 'runner_001' },
    ruleAgreed: true,
  }, over || {}));
}

function apply(who, helpId, people) {
  return call(who, {
    action: 'apply', helpId, message: '一起', peopleCount: people || 1,
    contact: { wechat: 'wx_' + USERS[who]._id },
  });
}

let pass = 0; const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fails.push(name); console.log('  ✗ ' + name + (detail ? '  → ' + JSON.stringify(detail) : '')); }
}
function section(t) { console.log('\n' + t); }

const helpDoc = id => coll('race_helps').get(id);
const notifyTo = uid => notifyCalls.filter(n => n.openid === USERS[uid]._openid).length;

// ---------------------------------------------------------------- 用例

(async () => {
  seed();

  section('A 发布与门槛');
  {
    // 未关注：临时删掉 C 的关注记录
    coll('race_markers').delete('m_c');
    const r = await publish('c');
    ok('未关注发布被拒', r.success === false && /关注/.test(r.error || ''), r);

    coll('race_markers').set('m_c', { _id: 'm_c', userId: 'u_c', eventId: 'E1' });
    const followed = await publish('c', { title: 'C 能发' });
    ok('关注后能发布', followed.success === true, followed);
    if (followed.id) coll('race_helps').delete(followed.id);   // 清掉，后面按 id 断言

    const noRule = await publish('owner', { ruleAgreed: false });
    ok('未勾选规则被拒', noRule.success === false && /规则/.test(noRule.error || ''), noRule);

    const badWx = await publish('owner', { contact: { wechat: 'a' } });
    ok('微信号格式被拒', badWx.success === false && /微信/.test(badWx.error || ''), badWx);

    const badDeadline = await publish('owner', { deadline: past(1) });
    ok('截止时间在过去被拒', badDeadline.success === false && /截止/.test(badDeadline.error || ''), badDeadline);

    const blockedWord = await publish('owner', { title: '名额转让速来' });
    ok('敏感词被拒', blockedWord.success === false, blockedWord);
  }

  let h1;
  {
    const r = await publish('owner');
    h1 = r.id;
    ok('正常发布成功', r.success === true && !!h1, r);
    ok('默认状态 open', helpDoc(h1).status === 'open');
  }

  section('B 可见性与联系方式');
  {
    const outsider = await call('c', { action: 'list' });
    const seen = outsider.list.find(x => x._id === h1);
    ok('组外看得到招募中', !!seen && seen.state === 'open', outsider.list.map(x => [x._id, x.state]));
    ok('列表不返回联系方式', outsider.list.every(x => x.contact === undefined), outsider.list[0]);

    const ownerView = await call('owner', { action: 'list' });
    ok('发起人 isMine=true', ownerView.list.find(x => x._id === h1).isMine === true);

    const noFollow = await call('c', { action: 'list', eventId: 'E2' });
    ok('未关注的赛事返回空列表', noFollow.followed === false && noFollow.list.length === 0, noFollow);
  }

  section('C 应征 → 招满自动完成');
  {
    const r1 = await apply('a', h1, 1);
    ok('A 应征成功', r1.success === true && r1.full === false, r1);
    ok('人数累加为 1', helpDoc(h1).applyPeople === 1, helpDoc(h1));

    const dup = await apply('a', h1, 1);
    ok('同一人重复应征被拒', dup.success === false, dup);

    const r2 = await apply('b', h1, 1);
    ok('B 应征后招满', r2.success === true && r2.full === true, r2);
    ok('招满自动 done/full', helpDoc(h1).status === 'done' && helpDoc(h1).doneReason === 'full', helpDoc(h1));

    const r3 = await apply('c', h1, 1);
    ok('已完成后不能再应征', r3.success === false && /已完成/.test(r3.error || ''), r3);

    const outsiderList = await call('c', { action: 'list' });
    ok('组外看不到已完成', !outsiderList.list.some(x => x._id === h1), outsiderList.list.map(x => [x._id, x.state]));

    const memberList = await call('a', { action: 'list' });
    const mineRow = memberList.list.find(x => x._id === h1);
    ok('组内看得到已完成', !!mineRow && mineRow.state === 'done', memberList.list.map(x => [x._id, x.state]));

    const mine = await call('owner', { action: 'myHelps' });
    ok('我的互助含应征者联系方式', mine.list[0].applicants.length === 2 && !!mine.list[0].applicants[0].contact.wechat, mine);
    ok('发起人自己能拿到原微信号（编辑表单回填用）', mine.list[0].myWechat === 'runner_001', mine.list[0].myWechat);
    ok('应征者列表拿不到发起人微信号', mine.list[0].contact === undefined, mine.list[0].contact);
    ok('我发布的带赛事名/日期', mine.list[0].eventName === '测试马拉松' && !!mine.list[0].eventDate, [mine.list[0].eventName, mine.list[0].eventDate]);

    const bMine = await call('b', { action: 'myApplies' });
    ok('我应征的也带赛事名', bMine.list[0].eventName === '测试马拉松', bMine.list[0].eventName);

    const follow = await call('c', { action: 'checkFollow' });
    ok('关注自检返回 followed', follow.followed === true, follow);
  }

  section('D 已完成退出（full 完成 → 退回招募中）');
  let bApplyId;
  {
    const mine = await call('b', { action: 'myApplies' });
    const row = mine.list.find(x => x._id === h1);
    bApplyId = row.applyId;
    ok('已完成时仍允许退出', row.canCancel === true, row);
    ok('已完成未退出时不给删除', row.canDelete === false, row);

    const before = notifyCalls.length;
    const r = await call('b', { action: 'cancelApply', applyId: bApplyId });
    ok('退出成功且重新开放招募', r.success === true && r.reopened === true, r);
    ok('状态退回 open', helpDoc(h1).status === 'open' && helpDoc(h1).doneReason === '', helpDoc(h1));
    ok('人数回落到 1', helpDoc(h1).applyPeople === 1, helpDoc(h1));
    ok('发起人收到通知', notifyTo('owner') > 0 && notifyCalls.length > before, { to: notifyTo('owner') });

    const outsiderList = await call('c', { action: 'list' });
    const backRow = outsiderList.list.find(x => x._id === h1);
    ok('组外又能看到（重新招募）', !!backRow && backRow.state === 'open', outsiderList.list.map(x => [x._id, x.state]));
  }

  let h2;
  section('E 截止后被退出 → 已截止（而不是已满）');
  {
    // 造一条招满的：need 1，让 A 应征
    const r = await publish('owner', { title: '拼车', peopleNeeded: 1 });
    h2 = r.id;
    await apply('a', h2, 1);
    ok('招满 done/full', helpDoc(h2).status === 'done' && helpDoc(h2).doneReason === 'full');

    // 模拟时间流逝：把截止时间挪到昨天
    helpDoc(h2).deadline = new Date(Date.now() - 86400000);

    const mineA = await call('a', { action: 'myApplies' });
    const row = mineA.list.find(x => x._id === h2);
    ok('过截止仍允许退出', row.canCancel === true, row);

    const q = await call('a', { action: 'cancelApply', applyId: row.applyId });
    ok('退出时状态退回 open（读时算成已截止）', q.success === true && helpDoc(h2).status === 'open', { q, doc: helpDoc(h2) });

    const ownerMine = await call('owner', { action: 'myHelps' });
    const h2view = ownerMine.list.find(x => x._id === h2);
    ok('我的互助显示为「已截止」', h2view.state === 'expired' && h2view.stateLabel === '已截止', h2view);

    const outsider = await call('c', { action: 'list' });
    ok('组外看不到已截止', !outsider.list.some(x => x._id === h2), outsider.list.map(x => [x._id, x.state]));
  }

  section('F owner 确认完成 → 退出不推翻状态');
  let h3;
  {
    const r = await publish('owner', { title: '拼饭', peopleNeeded: 3 });
    h3 = r.id;
    await apply('a', h3, 1);
    await apply('b', h3, 1);
    ok('未满时仍是 open', helpDoc(h3).status === 'open' && helpDoc(h3).doneReason === undefined);

    const f = await call('owner', { action: 'finish', helpId: h3 });
    ok('发起人确认完成', f.success === true && helpDoc(h3).status === 'done' && helpDoc(h3).doneReason === 'owner', helpDoc(h3));

    const mineB = await call('b', { action: 'myApplies' });
    const row = mineB.list.find(x => x._id === h3);
    const q = await call('b', { action: 'cancelApply', applyId: row.applyId });
    ok('退出成功但状态保持已完成', q.success === true && q.reopened === false && helpDoc(h3).status === 'done', { q, doc: helpDoc(h3) });
    ok('人数更新为 1', helpDoc(h3).applyPeople === 1, helpDoc(h3));

    const e = await call('owner', { action: 'finish', helpId: h3 });
    ok('已完成后不能再完成', e.success === false, e);
  }

  section('G 编辑再发起');
  {
    const onDone = await call('owner', { action: 'update', helpId: h3, type: 'room', title: '改标题', peopleNeeded: 2, deadline: future(5), contact: { wechat: 'runner_001' }, ruleAgreed: true });
    ok('已完成不给编辑', onDone.success === false && /已完成/.test(onDone.error || ''), onDone);

    // 取消一条，再编辑重发
    const r = await publish('owner', { title: '组队', peopleNeeded: 2 });
    const h4 = r.id;
    await apply('a', h4, 1);
    const c1 = await call('owner', { action: 'cancel', helpId: h4 });
    ok('取消成功并告知影响人数', c1.success === true && c1.applicantCount === 1, c1);
    ok('应征记录被作废', Array.from(coll('race_help_applies').values()).some(x => x.helpId === h4 && x.status === 'canceled' && x.cancelFlag === 'owner-canceled'));

    const u1 = await call('owner', { action: 'update', helpId: h4, type: 'meal', title: '改成拼饭', peopleNeeded: 3, deadline: future(6), contact: { wechat: 'runner_002' }, ruleAgreed: true });
    ok('已取消可以编辑再发起', u1.success === true && helpDoc(h4).status === 'open', u1);
    ok('编辑后角色/名额/联系方式已更新', helpDoc(h4).type === 'meal' && helpDoc(h4).peopleNeeded === 3 && helpDoc(h4).contact.wechat === 'runner_002', helpDoc(h4));
    ok('作废的应征不计入人数', helpDoc(h4).applyPeople === 0 && helpDoc(h4).applyCount === 0, helpDoc(h4));

    const ue = await call('owner', { action: 'update', helpId: h2, type: 'room', title: '已截止也能改', peopleNeeded: 2, deadline: future(4), contact: { wechat: 'runner_003' }, ruleAgreed: true });
    ok('已截止可以编辑再发起', ue.success === true && helpDoc(h2).status === 'open', ue);
    ok('改完不再是已截止', (await call('owner', { action: 'myHelps' })).list.find(x => x._id === h2).state === 'open');
  }

  section('H 取消');
  {
    const r = await publish('owner', { title: '无人应征', peopleNeeded: 2 });
    const h5 = r.id;
    const before = notifyCalls.length;
    const c = await call('owner', { action: 'cancel', helpId: h5 });
    ok('无人应征取消成功且不打扰人', c.success === true && c.applicantCount === 0 && notifyCalls.length === before, c);

    const again = await call('owner', { action: 'cancel', helpId: h5 });
    ok('重复取消被拒', again.success === false && /已经取消/.test(again.error || ''), again);

    const applyCanceled = await apply('a', h5, 1);
    ok('已取消的不能被应征', applyCanceled.success === false && /已取消/.test(applyCanceled.error || ''), applyCanceled);

    const outsider = await call('c', { action: 'list' });
    ok('已取消对组外不可见', !outsider.list.some(x => x._id === h5));

    const mineA = await call('a', { action: 'myApplies' });
    ok('被取消的记录不留在组外人的列表里', !mineA.list.some(x => x._id === h5));
  }

  section('I 删除');
  {
    const openHelp = await publish('owner', { title: '进行中别删', peopleNeeded: 2 });
    const d1 = await call('owner', { action: 'delete', helpId: openHelp.id });
    ok('进行中不能删除', d1.success === false, d1);

    const d2 = await call('owner', { action: 'delete', helpId: h3 });   // h3 是已完成
    ok('已完成可以删除', d2.success === true && helpDoc(h3).deleted === true, d2);
    ok('删除后我的互助不再出现', !(await call('owner', { action: 'myHelps' })).list.some(x => x._id === h3));
    ok('删除后组内列表不再出现', !(await call('a', { action: 'list' })).list.some(x => x._id === h3));
    ok('删除后应征者列表也不再出现', !(await call('a', { action: 'myApplies' })).list.some(x => x._id === h3));

    const d3 = await call('owner', { action: 'delete', helpId: h3 });
    ok('重复删除被拒', d3.success === false, d3);
  }

  section('J 应征者删除记录 / 取消应征');
  {
    const r = await publish('owner', { title: '进行中的一条', peopleNeeded: 3 });
    const h6 = r.id;
    await apply('a', h6, 1);

    const mineA = await call('a', { action: 'myApplies' });
    const row = mineA.list.find(x => x._id === h6);
    ok('进行中可取消应征、不可删除', row.canCancel === true && row.canDelete === false, row);

    const del = await call('a', { action: 'deleteApply', applyId: row.applyId });
    ok('进行中直接删除被拒', del.success === false, del);

    const q = await call('a', { action: 'cancelApply', applyId: row.applyId });
    ok('退出成功', q.success === true);

    const mineA2 = await call('a', { action: 'myApplies' });
    ok('自己退出的记录不再出现', !mineA2.list.some(x => x._id === h6));

    // 重新应征 → 已退出后可以删除记录
    await apply('a', h6, 1);
    const mineA3 = await call('a', { action: 'myApplies' });
    const row3 = mineA3.list.find(x => x._id === h6);
    await call('a', { action: 'cancelApply', applyId: row3.applyId });
    // myApplies 不返回已退出的，用库里直接取
    // 注意：互助记录里的 userId 存的是 openid，不是 users._id
    const applyRec = Array.from(coll('race_help_applies').values())
      .find(x => x.helpId === h6 && x.userId === USERS.a._openid && x.status === 'canceled');
    const del2 = await call('a', { action: 'deleteApply', applyId: applyRec._id });
    ok('退出后可以删除记录', del2.success === true && applyRec.deleted === true, del2);
  }

  section('K 我的互助四态齐全');
  {
    // 此时：h1 open(未满)、h2 open、h4 open、h6 open；再造已完成/已取消
    await call('owner', { action: 'finish', helpId: h1 });
    const h7 = (await publish('owner', { title: '要取消的' })).id;
    await call('owner', { action: 'cancel', helpId: h7 });

    const mine = await call('owner', { action: 'myHelps' });
    const states = mine.list.map(x => x.state).sort();
    ok('已完成仍是终态、留在列表里', states.includes('done'), states);
    ok('已取消也在列表里', states.includes('canceled'), states);
    ok('没有出现未知状态', states.every(s => ['open', 'expired', 'done', 'canceled'].indexOf(s) >= 0), states);
    ok('删除过的不在列表里', !mine.list.some(x => x._id === h3), mine.list.map(x => x._id));
  }

  section('L 越权与边界');
  {
    const h8 = (await publish('owner', { title: '越权测试' })).id;
    const other = await call('a', { action: 'cancel', helpId: h8 });
    ok('别人不能取消我的', other.success === false && /只能取消自己/.test(other.error || ''), other);

    const otherFinish = await call('a', { action: 'finish', helpId: h8 });
    ok('别人不能完成我的', otherFinish.success === false, otherFinish);

    const otherDelete = await call('a', { action: 'delete', helpId: h8 });
    ok('别人不能删我的', otherDelete.success === false, otherDelete);

    const otherEdit = await call('a', { action: 'update', helpId: h8, type: 'room', title: 'x', peopleNeeded: 1, deadline: future(3), contact: { wechat: 'abcde1' }, ruleAgreed: true });
    ok('别人不能编辑我的', otherEdit.success === false && /只能编辑自己/.test(otherEdit.error || ''), otherEdit);

    const selfApply = await call('owner', { action: 'apply', helpId: h8, peopleCount: 1, contact: { wechat: 'abcde1' } });
    ok('不能应征自己的', selfApply.success === false && /自己/.test(selfApply.error || ''), selfApply);

    const ghost = await call('a', { action: 'cancelApply', applyId: 'not-exist' });
    ok('不存在的应征记录被拒', ghost.success === false, ghost);

    const unknown = await call('a', { action: 'nope' });
    ok('未知操作被拒', unknown.success === false && /未知操作/.test(unknown.error || ''), unknown);
  }

  section('M 举报下架');
  {
    const h9 = (await publish('owner', { title: '举报测试' })).id;
    const r1 = await call('a', { action: 'report', helpId: h9 });
    ok('举报成功', r1.success === true, r1);
    const dup = await call('a', { action: 'report', helpId: h9 });
    ok('重复举报被拒', dup.success === false, dup);

    await call('b', { action: 'report', helpId: h9 });
    await call('c', { action: 'report', helpId: h9 });
    ok('满 3 次举报下架', helpDoc(h9).status === 'banned', helpDoc(h9));
    ok('下架后组外看不到', !(await call('b', { action: 'list' })).list.some(x => x._id === h9));
  }

  section('N 我关注的赛事（发布前先选一场）');
  {
    const mine = await call('owner', { action: 'myEvents' });
    ok('返回我关注的赛事', mine.success === true && mine.list.length === 1 && mine.list[0].eventId === 'E1', mine);
    ok('带出赛事名/日期/城市', mine.list[0].name === '测试马拉松' && mine.list[0].city === '北京' && mine.list[0].date === '2026-11-08', mine.list[0]);

    coll('race_markers').delete('m_c');
    const none = await call('c', { action: 'myEvents' });
    ok('一场都没关注时返回空（前端据此引导去关注）', none.success === true && none.list.length === 0, none);
    coll('race_markers').set('m_c', { _id: 'm_c', userId: 'u_c', eventId: 'E1' });

    // 赛事被删了也要能列出来，不能让用户看到空白无处可点
    coll('race_events').delete('E1');
    const orphan = await call('owner', { action: 'myEvents' });
    ok('赛事信息缺失时给兜底名', orphan.list.length === 1 && !!orphan.list[0].name, orphan.list[0]);
    coll('race_events').set('E1', { _id: 'E1', name: '测试马拉松', city: '北京', date: '2026-11-08' });
  }

  // ---------------------------------------------------------------- 汇总
  console.log('\n' + '─'.repeat(52));
  if (fails.length) {
    console.log(`结果：${pass} 通过，${fails.length} 失败`);
    fails.forEach(f => console.log('   ✗ ' + f));
    process.exitCode = 1;
  } else {
    console.log(`结果：${pass} 项全部通过`);
  }
})().catch((e) => {
  console.error('\n测试脚本异常：', e);
  process.exitCode = 1;
});
