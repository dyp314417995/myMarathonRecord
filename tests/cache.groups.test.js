// tests/cache.groups.test.js
//
// 锁住"改了数据必须让列表缓存失效"这条约定。
// 背景：跑群列表有 10 分钟缓存（cache.load + versionKey），但管理页加完群
// 只刷新了自己那一页，没有任何地方调 invalidate('groups')，
// 于是前台在 10 分钟内一直命中旧缓存——用户加完群看不到，以为没加上。
//
// 运行：node tests/cache.groups.test.js

const assert = require('assert');

// 用内存 Map 顶替 wx 的本地存储
const store = new Map();
global.wx = {
  getStorageSync: k => (store.has(k) ? store.get(k) : ''),
  setStorageSync: (k, v) => { store.set(k, v); },
  removeStorageSync: (k) => { store.delete(k); },
};

const cache = require('../miniprogram/utils/cache');

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra === undefined ? '' : '  → ' + JSON.stringify(extra))); }
}

const KEY = 'groups_public_list';
const TTL = 10 * 60 * 1000;   // 与 pages/groups/index.js 的 LIST_TTL 一致

function loaderFactory() {
  const box = { calls: 0 };
  box.fn = async () => {
    box.calls += 1;
    return [{ _id: 'g1', name: '一群' }, { _id: 'g' + box.calls, name: '第' + box.calls + '次查库' }];
  };
  return box;
}

(async () => {
  console.log('\n缓存失效约定');
  {
    store.clear();
    const L = loaderFactory();

    const r1 = await cache.load(KEY, L.fn, { ttl: TTL, versionKey: 'groups' });
    ok('首次加载真的查库', r1.fromCache === false && L.calls === 1, { fromCache: r1.fromCache, calls: L.calls });

    const r2 = await cache.load(KEY, L.fn, { ttl: TTL, versionKey: 'groups' });
    ok('未过期且版本一致时不查库', r2.fromCache === true && L.calls === 1, { fromCache: r2.fromCache, calls: L.calls });
    ok('缓存里拿到的是上次的数据', r2.data.length === 2 && r2.data[1].name === '第1次查库', r2.data);

    // 管理页加完群该做的事
    cache.invalidate('groups');

    const r3 = await cache.load(KEY, L.fn, { ttl: TTL, versionKey: 'groups' });
    ok('invalidate 之后必须重新查库（这就是加群不回显的根因）', r3.fromCache === false && L.calls === 2, { fromCache: r3.fromCache, calls: L.calls });
    ok('重新查库拿到的是新数据', r3.data[1].name === '第2次查库', r3.data);
  }

  console.log('\n各域互不干扰');
  {
    store.clear();
    const LA = loaderFactory();
    const LB = loaderFactory();

    await cache.load('list_a', LA.fn, { ttl: TTL, versionKey: 'a' });
    await cache.load('list_b', LB.fn, { ttl: TTL, versionKey: 'b' });

    cache.invalidate('a');
    const rb = await cache.load('list_b', LB.fn, { ttl: TTL, versionKey: 'b' });
    ok('作废 a 不影响 b 的缓存', rb.fromCache === true && LB.calls === 1, { fromCache: rb.fromCache, calls: LB.calls });

    const ra = await cache.load('list_a', LA.fn, { ttl: TTL, versionKey: 'a' });
    ok('a 自己会重新查库', ra.fromCache === false && LA.calls === 2, { fromCache: ra.fromCache, calls: LA.calls });
  }

  console.log('\n缓存 key 与版本号');
  {
    store.clear();
    const L = loaderFactory();
    await cache.load(KEY, L.fn, { ttl: TTL, versionKey: 'groups_v1' });
    // 只把 versionKey 从 groups_v1 改成 groups，版本号两边都还是 0，比对相等 → 仍命中。
    // 这条锁住事实：指望"改个名字就让老缓存失效"是不成立的。
    const same = await cache.load(KEY, L.fn, { ttl: TTL, versionKey: 'groups' });
    ok('只改 versionKey 名字不算失效', same.fromCache === true && L.calls === 1, { fromCache: same.fromCache, calls: L.calls });

    // 真正让老设备上的旧缓存作废的办法：换 cacheKey（页面已改成 groups_public_list_v2）
    const fresh = await cache.load(KEY + '_v2', L.fn, { ttl: TTL, versionKey: 'groups' });
    ok('换 cacheKey 不会命中旧缓存', fresh.fromCache === false && L.calls === 2, { fromCache: fresh.fromCache, calls: L.calls });
  }

  console.log('\nTTL 过期');
  {
    store.clear();
    const L = loaderFactory();
    await cache.load(KEY, L.fn, { ttl: 1, versionKey: 'groups' });
    await new Promise(r => setTimeout(r, 10));
    const r = await cache.load(KEY, L.fn, { ttl: 1, versionKey: 'groups' });
    ok('过期后重新查库', r.fromCache === false && L.calls === 2, { fromCache: r.fromCache, calls: L.calls });
  }

  console.log('\n读取接口的健壮性');
  {
    store.clear();
    ok('没缓存时 get 返回 null', cache.get(KEY) === null);
    store.set('cache_' + KEY, '不是 JSON');
    ok('坏数据不抛异常，返回 null', cache.get(KEY) === null);
    store.set('cache_' + KEY, JSON.stringify({ _t: Date.now(), _d: [] }));
    ok('缺 _ttl 时按默认 TTL 处理（默认 5 分钟）', Array.isArray(cache.get(KEY)));
  }

  console.log('\n结果：' + (fail === 0 ? pass + ' 项全部通过' : pass + ' 通过，' + fail + ' 失败'));
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('测试自身异常：', e);
  process.exit(1);
});
