// cloudfunctions/raceSourceProbe/index.js
// P0 源探测：逐个抓候选赛事采集源，评估「连通性 + 可解析性」，只读不写库。
// 用法：云开发控制台 → 云函数 → raceSourceProbe → 云端测试，直接运行，看返回 JSON。
const https = require('https');
const http = require('http');
const zlib = require('zlib');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const TIMEOUT = 10000; // 单源超时（毫秒）

const SOURCES = [
  { key: 'athletics',  name: '中国田径协会',   url: 'https://www.athletics.org.cn/' },
  { key: 'runchina',   name: '中国马拉松官网', url: 'http://www.runchina.org.cn/' },
  { key: 'zuicool',    name: '最酷',           url: 'https://www.zuicool.com/' },
  { key: 'mararun',    name: '马拉马拉',       url: 'https://www.mararun.com/' },
  { key: 'saihuitong', name: '赛会通',         url: 'https://www.saihuitong.com/' },
  { key: 'mlsbmw',     name: '马拉松报名网',   url: 'https://www.mlsbmw.com/' },
  { key: 'iranshao',   name: '爱燃烧',         url: 'https://www.iranshao.com/' },
  { key: 'zhixingheyi', name: '知行合逸',      url: 'https://www.zhixingheyi.com/' },
];

// 从首页挖掘到的真实列表/详情页（探测用）
const LIST_URLS = [
  { key: 'zuicool',    name: '最酷-赛事列表',   url: 'https://zuicool.com/events' },
  { key: 'zuicool',    name: '最酷-详情页',     url: 'https://zuicool.com/event/58557' },
  { key: 'athletics',  name: '田径协会-赛事栏目', url: 'https://www.athletics.org.cn/event/' },
  { key: 'athletics',  name: '田径协会-赛事公告', url: 'https://www.athletics.org.cn/bulletin/competition/' },
  { key: 'saihuitong', name: '赛会通-赛事列表', url: 'https://www.saihuitong.com/event.html' },
  { key: 'mlsbmw',     name: '马拉松报名网-赛事', url: 'https://www.mlsbmw.com/match' },
  { key: 'mlsbmw',     name: '马拉松报名网-赛事日历', url: 'https://www.mlsbmw.com/racecalendar' },
];

function fetchUrl(url, redirects = 0) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*;q=0.9' },
    }, (res) => {
      const status = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status) && redirects < 5 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        fetchUrl(next, redirects + 1).then(r => { r.durationMs = Date.now() - t0; resolve(r); });
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
        } catch (e) { /* 解压失败用原始字节 */ }
        resolve({
          status,
          finalUrl: url,
          contentType: res.headers['content-type'] || '',
          bytes: buf.length,
          durationMs: Date.now() - t0,
          body: buf,
        });
      });
      res.on('error', () => resolve({ status, finalUrl: url, contentType: res.headers['content-type'] || '', bytes: 0, durationMs: Date.now() - t0, body: Buffer.alloc(0), error: 'stream error' }));
    });
    req.setTimeout(TIMEOUT, () => { req.destroy(); resolve({ error: 'timeout', durationMs: Date.now() - t0 }); });
    req.on('error', (e) => resolve({ error: (e && e.message) || String(e), durationMs: Date.now() - t0 }));
  });
}

function analyze(item, r) {
  const out = {
    key: item.key, name: item.name, url: item.url,
    ok: false, status: 0, finalUrl: item.url, contentType: '', bytes: 0,
    durationMs: r.durationMs || 0, title: '', totalLinks: 0, raceLinks: 0,
    spaHint: false, sample: '', error: '',
  };
  if (r.error) { out.error = r.error; return out; }
  out.status = r.status;
  out.finalUrl = r.finalUrl || item.url;
  out.contentType = r.contentType;
  out.bytes = r.bytes;
  if (r.status >= 200 && r.status < 400 && r.bytes > 0) {
    out.ok = true;
    const text = r.body.toString('utf8');
    const m = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    out.title = m ? m[1].replace(/\s+/g, ' ').trim().slice(0, 80) : '';
    const hrefs = [...text.matchAll(/href=["']([^"']+)["']/gi)].map(x => x[1]);
    out.totalLinks = hrefs.length;
    out.raceLinks = hrefs.filter(h => /(marathon|马拉松|race|match|competition)/i.test(h)).length;
    const hasSpaMarkers = /__NUXT__|__INITIAL_STATE__|createApp\(|<div[^>]*id=["']app["']/i.test(text);
    out.spaHint = text.length < 3000 || hasSpaMarkers;
    out.sample = text.replace(/\s+/g, ' ').slice(0, 60);
  }
  return out;
}

exports.main = async () => {
  const lists = await Promise.all(LIST_URLS.map(async s => analyze(s, await fetchUrl(s.url))));
  return {
    generatedAt: new Date().toISOString(),
    note: 'status 200/3xx=可达；000/timeout/error=不可达；spaHint=true=JS渲染需另找接口',
    listPages: lists,
  };
};