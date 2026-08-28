// cloudfunctions/raceAutoFetch/index.js - 赛事自动采集定时任务（单文件版）
// 每天 02:00 触发（控制台配置定时触发器）；也可手动调用 { sources:['zuicool'], dryRun:true }
// 规则：自动抓取 → 草稿；草稿可全量更新；已发布冻结；去重 sourceUrl → sourceId → name
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const https = require('https');
const http = require('http');
const zlib = require('zlib');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ============ HTTP 抓取 ============
function fetchHtml(url, timeout = 15000, redirects = 0) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*;q=0.9' },
    }, (res) => {
      const status = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location && redirects < 5) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        fetchHtml(next, timeout, redirects + 1).then(resolve);
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        let buf = Buffer.concat(chunks);
        const enc = res.headers['content-encoding'];
        try {
          if (enc && enc.includes('gzip')) buf = zlib.gunzipSync(buf);
          else if (enc && enc.includes('deflate')) buf = zlib.inflateSync(buf);
        } catch (e) { /* ignore */ }
        resolve({ ok: status >= 200 && status < 400 && buf.length > 0, status, html: buf.toString('utf8'), error: '' });
      });
      res.on('error', () => resolve({ ok: false, status, html: '', error: 'stream error' }));
    });
    req.setTimeout(timeout, () => { req.destroy(); resolve({ ok: false, html: '', error: 'timeout' }); });
    req.on('error', (e) => resolve({ ok: false, html: '', error: (e && e.message) || String(e) }));
  });
}

// ============ 解析辅助 ============
function extractYear(text) {
  const m = /(20\d{2})/.exec(text || '');
  return m ? m[1] : '';
}
// 名称去掉年份（命名规范：name 带年份、raceGroup 不带年份）
function stripYear(name) {
  return (name || '').replace(/^(20\d{2})\s*/, '').replace(/[「·\s]?(20\d{2})$/, '').trim();
}
function cleanTitle(title) {
  let t = String(title || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  t = t.replace(/\s*[-–—|]\s*(中国田径协会官方网站|华奥星空|最酷|马拉松网).*$/, '');
  return t.trim();
}
function parseDateFromDesc(desc, year) {
  const m = /(?:定于|于|在)?\s*(\d{1,2})月(\d{1,2})日/.exec(desc || '');
  if (m) {
    const y = parseInt(year, 10) || new Date().getFullYear();
    return new Date(y, parseInt(m[1], 10) - 1, parseInt(m[2], 10));
  }
  return null;
}
function parseCityFromDesc(desc) {
  const m = /在([\u4e00-\u9fa5]{2,4}?省)?([\u4e00-\u9fa5]{2,8}?市)/.exec(desc || '');
  if (m && m[2]) return m[2].replace(/(省|市)$/, '');
  return '';
}
function parseRaceTypes(text) {
  const types = new Set();
  const t = text || '';
  if (/半程|半马|半马拉松/.test(t)) types.add('half');
  if (/10公里|10km|10k/i.test(t)) types.add('10k');
  if (/全程|马拉松/.test(t)) types.add('full');
  if (!types.size) types.add('full');
  return [...types];
}

// 不做越野赛事：命中越野关键词直接跳过，避免误采集
function isTrailRace(text) {
  return /越野|越野跑|越野赛|trail\s*(run|race|running)/i.test(text || '');
}

// ============ 采集源：最酷（主源） ============
async function zuicoolList() {
  const res = await fetchHtml('https://zuicool.com/events');
  if (!res.ok) throw new Error(`最酷列表抓取失败: ${res.error || res.status}`);
  const ids = [...new Set([...res.html.matchAll(/\/event\/(\d+)/g)].map(m => m[1]))];
  if (!ids.length) throw new Error('最酷列表未解析到赛事 ID');
  return ids.map(id => ({ id, sourceUrl: `https://zuicool.com/event/${id}`, sourceId: id }));
}
async function zuicoolDetail(item) {
  const res = await fetchHtml(item.sourceUrl);
  if (!res.ok) throw new Error(`最酷详情抓取失败: ${res.error || res.status}`);
  const html = res.html;
  const title = cleanTitle((html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '');
  const desc = (html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"/i) || [])[1] || '';
  const year = extractYear(title);
  const raceName = title || `赛事${item.id}`;
  const feeM = /(报名费[^。；;]{0,80})/.exec(desc);
  const scaleM = /(?:赛事)?规模\s*(\d+)/.exec(desc);
  return {
    name: raceName,
    raceGroup: stripYear(raceName),
    date: parseDateFromDesc(desc, year) || parseDateFromDesc(html, year),
    city: parseCityFromDesc(desc),
    raceTypes: parseRaceTypes(title + desc),
    fee: feeM ? feeM[1].trim() : '',
    scale: scaleM ? scaleM[1] : '',
    website: item.sourceUrl,
    description: desc.slice(0, 500),
    sourceSite: '最酷',
    sourceUrl: item.sourceUrl,
    sourceId: item.sourceId,
  };
}

// ============ 采集源：中国田径协会（官方补充） ============
const ATH_NEG = /培训班|裁判员|丈量员|晋级|考核|会议|研讨|培训|学习班|晋升|教练员|注册|装备|兴奋剂|反兴奋剂|补办|公示|修订|征求意见/;
const ATH_LISTS = [
  'https://www.athletics.org.cn/bulletin/competition/',
  'https://www.athletics.org.cn/bulletin/marathon/',
];
async function athleticsList() {
  const items = [];
  for (const url of ATH_LISTS) {
    const res = await fetchHtml(url);
    if (!res.ok) continue;
    // 兼容两种标记：<a href="x.html" title="标题"> 或 <a href="x.html">链接文本</a>
    const re = /<a[^>]*href="([^"]+\.html)"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = re.exec(res.html))) {
      const hrefRaw = m[1];
      const titleAttr = (m[0].match(/title="([^"]*)"/) || [])[1] || '';
      const linkText = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      const title = cleanTitle(titleAttr || linkText);
      if (!/(马拉松|路跑|半程|10公里|10K|10km)/i.test(title)) continue;
      if (ATH_NEG.test(title)) continue;
      const href = hrefRaw.startsWith('http') ? hrefRaw : 'https://www.athletics.org.cn' + (hrefRaw.startsWith('/') ? '' : '/') + hrefRaw;
      const idM = /(\d+)\.html/.exec(href);
      items.push({ id: idM ? idM[1] : href, sourceUrl: href, sourceId: idM ? idM[1] : '', title });
    }
  }
  const seen = new Set();
  return items.filter(i => { if (seen.has(i.sourceUrl)) return false; seen.add(i.sourceUrl); return true; });
}
async function athleticsDetail(item) {
  const res = await fetchHtml(item.sourceUrl);
  const desc = res.ok ? ((res.html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"/i) || [])[1] || '') : '';
  const year = extractYear(item.title);
  const raceName = item.title.replace(/(补充)?通知$/, '').trim() || item.title;
  return {
    name: raceName,
    raceGroup: stripYear(raceName),
    // 先看 meta description，再回退解析全文 HTML，避免因日期未提取而跳过
    date: parseDateFromDesc(desc, year) || parseDateFromDesc(res.html, year),
    city: parseCityFromDesc(desc),
    raceTypes: parseRaceTypes(item.title + desc),
    website: item.sourceUrl,
    description: desc.slice(0, 500),
    sourceSite: '中国田径协会',
    sourceUrl: item.sourceUrl,
    sourceId: item.sourceId,
  };
}

const SOURCES = [
  { key: 'zuicool', name: '最酷', maxPerRun: 50, fetchList: zuicoolList, fetchDetail: zuicoolDetail },
  { key: 'athletics', name: '中国田径协会', maxPerRun: 30, fetchList: athleticsList, fetchDetail: athleticsDetail },
];

function todayStr() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
}

// ============ 去重 + 建草稿/更新草稿/跳过已发布 ============
async function upsertDraft(race, dryRun) {
  let existing = null;
  if (race.sourceUrl) {
    const byUrl = await db.collection('race_events').where({ sourceUrl: race.sourceUrl }).limit(1).get();
    if (byUrl.data.length) existing = byUrl.data[0];
  }
  if (!existing && race.sourceId) {
    const byId = await db.collection('race_events').where({ sourceId: race.sourceId, source: 'auto' }).limit(1).get();
    if (byId.data.length) existing = byId.data[0];
  }
  if (!existing && race.name) {
    const byName = await db.collection('race_events').where({ name: race.name }).limit(1).get();
    if (byName.data.length) existing = byName.data[0];
  }

  if (!existing) {
    if (dryRun) return 'created';
    const now = new Date();
    await db.collection('race_events').add({
      data: {
        ...race,
        // 采集不收集海报：明确为空，避免带入默认/错误图片
        poster: '', posters: [],
        publishStatus: 'draft',
        source: 'auto',
        status: race.date < now ? 'finished' : 'upcoming',
        firstSeenAt: now,
        lastAutoFetchAt: now,
        autoFetchedCount: 1,
        createTime: now,
        updateTime: now,
      },
    });
    return 'created';
  }

  if (existing.publishStatus !== 'draft') return 'skipped';
  if (dryRun) return 'updated';

  const now = new Date();
  const patch = {
    ...race,
    // 采集不收集海报：清掉历史污染的默认图片（如默认上海马拉松图）
    poster: '', posters: [],
    source: 'auto',
    status: race.date < now ? 'finished' : 'upcoming',
    lastAutoFetchAt: now,
    autoFetchedCount: (existing.autoFetchedCount || 0) + 1,
    updateTime: now,
  };
  await db.collection('race_events').doc(existing._id).update({ data: patch });
  return 'updated';
}

async function runSource(src, dryRun, limit) {
  const stat = { source: src.key, fetched: 0, created: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
  try {
    const list = await src.fetchList();
    const items = (list || []).slice(0, limit || src.maxPerRun || 50);
    stat.fetched = items.length;
    for (const item of items) {
      try {
        const race = await src.fetchDetail(item);
        if (!race.name || !race.date) {
          stat.failed++;
          stat.errors.push(`缺名称/日期: ${item.sourceUrl}`);
          continue;
        }
        // 不做越野赛事：命中越野关键词直接跳过
        if (isTrailRace(race.name + ' ' + (race.description || ''))) {
          stat.skipped++;
          continue;
        }
        const action = await upsertDraft(race, dryRun);
        if (action === 'created') stat.created++;
        else if (action === 'updated') stat.updated++;
        else if (action === 'skipped') stat.skipped++;
      } catch (e) {
        stat.failed++;
        stat.errors.push((e.message || String(e)).slice(0, 200));
      }
    }
  } catch (e) {
    stat.failed++;
    stat.errors.push(`源错误: ${(e.message || String(e)).slice(0, 200)}`);
  }
  return stat;
}

exports.main = async (event = {}) => {
  // 冒烟自检：不联网、不写库，验证函数本身能跑
  if (event.smoke) {
    return { ok: true, smoke: true, now: Date.now() };
  }

  const only = Array.isArray(event.sources) ? event.sources : null;
  const dryRun = !!event.dryRun;
  const limit = parseInt(event.limit, 10) > 0 ? parseInt(event.limit, 10) : 0;
  const log = { date: todayStr(), dryRun, sources: [] };

  for (const src of SOURCES) {
    if (only && !only.includes(src.key)) continue;
    log.sources.push(await runSource(src, dryRun, limit));
  }

  if (!dryRun) {
    try {
      await db.collection('race_fetch_log').add({ data: { ...log, createTime: new Date() } });
    } catch (e) {
      console.warn('race_fetch_log 写入失败（集合不存在时忽略）:', e);
    }
  }
  return log;
};