// tests/db.groups.paging.test.js
//
// 锁住「小程序端单次查询最多 20 条」这条平台限制，以及 getGroups 的分页行为。
// 背景：管理页加完群看不到，就是因为只查了一次（默认 20 条），
// 而群按 sort 升序、新群排最后，第 21 个起永远查不出来。
// 期间还走过弯路：把 limit 写成 100 —— 小程序端不允许，写了也白写。
//
// 运行：node tests/db.groups.paging.test.js

const assert = require('assert');

// ---- 假数据库：真实模拟小程序端的 20 条上限 -------------------------------
const USERS = [];
const GROUPS = Array.from({ length: 45 }, (_, i) => ({
  _id: 'g' + (i + 1),
  name: '群' + (i + 1),
  sort: i + 1,
  memberCount: 0,
}));

let getCalls = 0;

function makeQuery(name) {
  const state = { order: null, skip: 0, limit: 20 };
  const api = {
    where() { return api; },
    orderBy(f, d) { state.order = [f, d]; return api; },
    skip(n) { state.skip = n; return api; },
    limit(n) { state.limit = n; return api; },
    async get() {
      getCalls += 1;
      // 官方限制：小程序端 limit 不能超过 20
      if (state.limit > 20) throw new Error('limit 超过小程序端上限 20');
      let rows = (name === 'groups' ? GROUPS : USERS).slice();
      if (state.order) {
        const [f, dir] = state.order;
        rows.sort((a, b) => (a[f] > b[f] ? 1 : a[f] < b[f] ? -1 : 0) * (dir === 'desc' ? -1 : 1));
      }
      return { data: rows.slice(state.skip, state.skip + state.limit) };
    },
    async count() { return { total: (name === 'groups' ? GROUPS : USERS).length }; },
    doc(id) {
      return {
        async get() { return { data: (name === 'groups' ? GROUPS : USERS).find(x => x._id === id) }; },
        async update() { return { stats: { updated: 1 } }; },
        async remove() { return { stats: { removed: 1 } }; },
      };
    },
  };
  return api;
}

global.wx = {
  cloud: {
    database: () => ({ collection: (n) => makeQuery(n), command: {} }),
  },
};

const dbUtil = require('../miniprogram/utils/db');

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra === undefined ? '' : '  → ' + JSON.stringify(extra))); }
}

(async () => {
  console.log('\n群组查询的分页行为');
  {
    const res = await dbUtil.getGroups();
    ok('45 个群全部取回，不是 20 个', res.data.length === 45, res.data.length);
    ok('顺序仍按 sort 升序', res.data[0].sort === 1 && res.data[44].sort === 45, [res.data[0].sort, res.data[44].sort]);
    ok('返回结构保持 { data }，老调用方不用改', Array.isArray(res.data));
    ok('翻了 3 页（20 + 20 + 5），没有多查', getCalls === 3, getCalls);
    ok('最后那个群（第 45 个）确实在结果里', res.data[res.data.length - 1]._id === 'g45', res.data[res.data.length - 1]);
  }

  console.log('\n边界');
  {
    // 正好 20 个：要再取一次确认后面没有了
    GROUPS.length = 20;
    getCalls = 0;
    const res = await dbUtil.getGroups();
    ok('正好 20 个时取到 20 个', res.data.length === 20, res.data.length);
    ok('会多查一次确认到底了（20 条 == 一页，不能直接断定结束）', getCalls === 2, getCalls);

    // 1 个
    GROUPS.length = 1;
    getCalls = 0;
    const one = await dbUtil.getGroups();
    ok('只有 1 个群时取到 1 个', one.data.length === 1, one.data.length);
    ok('只查 1 次', getCalls === 1, getCalls);

    // 0 个
    GROUPS.length = 0;
    getCalls = 0;
    const none = await dbUtil.getGroups();
    ok('没有群时返回空数组', Array.isArray(none.data) && none.data.length === 0, none.data);
  }

  console.log('\n通用分页工具 fetchAll');
  {
    // 前面的边界测试把数据改小了，这里恢复成 45 个
    GROUPS.length = 0;
    Array.from({ length: 45 }, (_, i) => GROUPS.push({ _id: 'g' + (i + 1), name: '群' + (i + 1), sort: i + 1 }));

    getCalls = 0;
    let built = 0;
    const res = await dbUtil.fetchAll(() => { built += 1; return makeQuery('groups').orderBy('sort', 'asc'); });
    ok('fetchAll 取回全部 45 条', res.data.length === 45, res.data.length);
    ok('翻了 3 页', getCalls === 3, getCalls);
    ok('每次 skip 都重新建查询对象（链式 API 是不可变的）', built === 3, built);

    getCalls = 0;
    const capped = await dbUtil.fetchAll(() => makeQuery('groups').orderBy('sort', 'asc'), { max: 10 });
    ok('max 能兜住总量（只取前 10 条）', capped.data.length === 10, capped.data.length);

    getCalls = 0;
    const big = await dbUtil.fetchAll(() => makeQuery('groups').orderBy('sort', 'asc'), { pageSize: 100 });
    ok('pageSize 传 100 会被压回 20（平台上限），不会报错', big.data.length === 45 && getCalls === 3, [big.data.length, getCalls]);

    GROUPS.length = 0;
    getCalls = 0;
    const none = await dbUtil.fetchAll(() => makeQuery('groups'));
    ok('空集合返回空数组', Array.isArray(none.data) && none.data.length === 0, none.data);
    ok('空集合只查 1 次', getCalls === 1, getCalls);
  }

  console.log('\n避免再次踩同一个坑');
  {
    const read = p => require('fs').readFileSync(__dirname + '/' + p, 'utf8');
    const OVER20 = /limit\(\s*(2[1-9]|[3-9]\d|\d{3,})\s*\)/;

    const src = read('../miniprogram/utils/db.js');
    const body = src.slice(src.indexOf('async function fetchAll'), src.indexOf('// ============ 群组操作'));
    ok('fetchAll 用 skip 翻页', /skip\(/.test(body));
    ok('fetchAll 把 pageSize 压在 20 以内', /Math\.min\([\s\S]{0,60}?,\s*20\)/.test(body), body.slice(0, 400));
    ok('getGroups 改成走 fetchAll', /async function getGroups\(\)[\s\S]{0,240}fetchAll\(/.test(src));

    const certSrc = read('../miniprogram/pages/records/certificates.js');
    ok('荣耀时刻不再写 limit(200)', !OVER20.test(certSrc) && /dbUtil\.fetchAll\(/.test(certSrc), certSrc.match(/limit\([^)]*\)/g));

    const adminSrc = read('../miniprogram/pages/points/admin.js');
    ok('待审核用户不再写 limit(50)', !OVER20.test(adminSrc) && /dbUtil\.fetchAll\(/.test(adminSrc), adminSrc.match(/limit\([^)]*\)/g));
  }

  console.log('\n结果：' + (fail === 0 ? pass + ' 项全部通过' : pass + ' 通过，' + fail + ' 失败'));
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('测试自身异常：', e);
  process.exit(1);
});
