// CSV → race_events 标准化对象（按新字段模型）
// 用法: node csv-to-races.js [输出json路径]
const fs = require("fs");
const path = require("path");
const DIR = __dirname;
﻿// 行政区划（全国完整版）用于从赛事名提取城市
const CITY_DATA = require('../miniprogram/utils/city-data.js');

// 扁平化地级市/区县名（去后缀），供赛事名匹配
const CITY_NAMES = [];
const DISTRICT_NAMES = [];
const SUFFIX_CITY = /(市|地区|自治州|盟|特别行政区)$/;
const SUFFIX_DIST = /(市|区|县|自治县|旗|新区|管理局|开发区)$/;
CITY_DATA.forEach(prov => {
  (prov.children || []).forEach(city => {
    const cn = city.name.replace(SUFFIX_CITY, '');
    if (cn.length >= 2) CITY_NAMES.push(cn);
    (city.children || []).forEach(d => {
      const dn = d.name.replace(SUFFIX_DIST, '');
      if (dn.length >= 2) DISTRICT_NAMES.push(dn);
    });
  });
});
// 台湾/港澳简繁补充（city-data 台湾省为空）
const EXTRA_CITIES = ['台北','臺北','高雄','新北','台中','臺中','臺南','台南','桃园','桃園','新竹','基隆','嘉义','嘉義','彰化','南投','云林','雲林','屏东','屏東','宜兰','宜蘭','花莲','花蓮','台东','臺東','澎湖','金门','金門','连江','連江','苗栗','香港','澳门','澳門'];
EXTRA_CITIES.forEach(n => { if (!CITY_NAMES.includes(n)) CITY_NAMES.push(n); });

const SHEETS = [["路跑赛事_2027.csv", 2027], ["路跑赛事_2026.csv", 2026], ["路跑赛事_2025.csv", 2025], ["路跑赛事_2024H2.csv", 2024], ["路跑赛事_2024H1.csv", 2024]];
function parseCSV(text){
  const rows=[]; let row=[], cur="", inQ=false;
  for(let i=0;i<text.length;i++){ const ch=text[i];
    if(inQ){ if(ch==="\""){ if(text[i+1]==="\""){ cur+="\""; i++; } else inQ=false; } else cur+=ch; }
    else { if(ch==="\"") inQ=true; else if(ch===","){ row.push(cur); cur=""; } else if(ch==="\n"){ row.push(cur); rows.push(row); row=[]; cur=""; } else if(ch==="\r"){} else cur+=ch; }
  }
  if(cur!==""||row.length){ row.push(cur); rows.push(row); }
  return rows;
}
function col(header, names){ for(const n of names){ const i=header.indexOf(n); if(i>=0) return i; } return -1; }
function stripYear(n){ return (n||"").replace(/^(20\d{2})[年\s·\-–—]*/,"").replace(/[·\s\-–—]*(20\d{2})$/,"").replace(/^(20\d{2})$/,"").trim(); }
function parseDate(v){ const m=/(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v||""); if(m) return m[1]+"-"+m[2].padStart(2,"0")+"-"+m[3].padStart(2,"0"); return ""; }
function parseTime(v){ const m=/(\d{1,2}):(\d{2})/.exec(v||""); if(m) return m[1].padStart(2,"0")+":"+m[2]; return ""; }
function parseTypes(text){ const t=text||""; const out=[]; if(/全程|马拉松(?!半)|全马/.test(t)) out.push("full"); if(/半程|半马|半马拉松/.test(t)) out.push("half"); if(/10km|10k|10公里|短距离/.test(t)) out.push("10k"); return out.length?out:["full"]; }
function parseLevel(text){ const t=text||""; if(/A1|A类|(^|\/|\s)A($|\/|\s)/.test(t)) return "A"; if(/B类|(^|\/|\s)B($|\/|\s)/.test(t)) return "B"; if(/(^|\/|\s)C($|\/|\s)/.test(t)) return "C"; return ""; }
function parseLabel(text){ const t=text||""; if(t.indexOf("白金标")>=0) return "白金标"; if(t.indexOf("金标")>=0) return "金标"; if(t.indexOf("精英")>=0) return "精英标"; if(t.indexOf("标牌")>=0||/WA|AIMS/.test(t)) return "普通标"; return ""; }
function parseMechanism(text){ const t=text||""; if(t.indexOf("✔")>=0||t.indexOf("✓")>=0) return "抽签"; if(t.indexOf("✘")>=0||t.indexOf("✗")>=0||t.indexOf("❌")>=0) return "先到先得"; return ""; }
function parsePayment(v){
  // 直接取原值（表格「缴费时间」列：报名时缴费 / 中签后缴费）
  const t = (v || '').trim();
  return (/报名时|中签后/.test(t)) ? t : '';
}
function cleanCity(s){
  s = String(s || '').trim();
  s = s.replace(/^(中国田径协会|中国|中华|全国|国际|世界|国家)/, '');
  s = s.replace(/(市|省|县|区|站|马拉松|半程马拉松|全程马拉松)$/, '');
  s = s.replace(/[A-Za-z0-9\s·\-–—()（）]+$/, '').trim();
  return s;
}
﻿﻿// 从赛事名提取城市：优先括号内行政区划 → name 开头行政区划 → 启发式兜底
function extractCity(name){
  let n = String(name || '').trim();
  // 1) 括号内必须命中行政区划才采用（如「北京门头沟站」「三亚」「in臺南」）
  const paren = /[（(]([^（）()]{2,10}?)(?:站)?[）)]/.exec(n);
  if (paren) {
    const pc = paren[1];
    for (const cc of CITY_NAMES) { if (pc.indexOf(cc) >= 0) return cc; }
    for (const dd of DISTRICT_NAMES) { if (pc.indexOf(dd) >= 0) return dd; }
  }
  // 2) name 开头前 6 字符内匹配行政区划（赛事名通常「城市+马拉松」）
  const head6 = n.slice(0, 6);
  let best = '';
  for (const cc of CITY_NAMES) { if (head6.indexOf(cc) >= 0 && cc.length > best.length) best = cc; }
  if (best) return best;
  for (const dd of DISTRICT_NAMES) { if (head6.indexOf(dd) >= 0 && dd.length > best.length) best = dd; }
  if (best) return best;
  // 3) 启发式兜底：去掉年份/连接词，取开头到赛事类型词前
  n = n.replace(/^\s*(20\d{2})\s*/, '');
  n = n.split(/暨|·|&|与/)[0];
  const m = /(半程马拉松|全程马拉松|马拉松|半马|全马|10公里|10km|10k|精英赛|越野|挑战赛|欢乐跑|接力|竞走|大师赛|巡回赛|锦标赛)/i.exec(n);
  let head = m ? n.slice(0, m.index) : n;
  head = cleanCity(head);
  return (head.length >= 2 && head.length <= 8) ? head : '';
}
function num(v){ const m=/(\d[\d,]*(?:\.\d+)?)/.exec(v||""); if(!m) return ""; return m[1].replace(/,/g,""); }
function timelineItem(label, v){ if(!v) return null; const date=parseDate(v); if(!date) return null; return { label, date, time: parseTime(v) || "" }; }
function buildRace(row, header, sheetYear){
  const g=v=>{ const i=col(header,v); return i>=0?row[i]||"":""; };
  const name = g(["赛事","赛事名称"]).trim();
  if(!name) return null;
  const dateStr = parseDate(g(["比赛日期","开赛日期"]));
  if(!dateStr) return null;
  const year = parseInt(dateStr.slice(0,4),10) || sheetYear;
  const raceGroup = stripYear(name);
  const finalName = raceGroup + String(year);
  const levelTxt = g(["赛事等级"]);
  const timeline = [timelineItem("报名开启", g(["报名开启时间"])), timelineItem("报名截止", g(["报名截止时间"])), timelineItem("出签时间", g(["出签日期"])), timelineItem("缴费截止", g(["缴费时间"])), timelineItem("鸣枪开跑", dateStr)].filter(Boolean);
  const regStatus = g(["状态"]).trim();
  return {
    name: finalName, raceGroup, date: dateStr, province: g(["省份"]).trim(), city: extractCity(name),
    raceTypes: parseTypes(g(["比赛项目"])), raceLevel: parseLevel(levelTxt), label: parseLabel(levelTxt),
    scale: num(g(["总规模"])), subScale: g(["分项规模"]).trim(), fee: g(["报名费"]).trim(),
    organizer: g(["主办单位"]).trim(), operator: g(["运营单位"]).trim(),
    contactPhone: g(["联系电话"]).trim(), contactEmail: g(["官方邮箱"]).trim(), wechatAccount: g(["微信公众号"]).trim(), website: g(["官网"]).trim(),
    mechanism: parseMechanism(g(["抽签"])), payment: parsePayment(g(["缴费时间"])), signupChannels: g(["报名渠道"]).trim(),
    medicalReport: g(["体检报告"]).trim(), finishRequirement: g(["完赛经历要求"]).trim(), refundRule: g(["退出机制"]).trim(), startPoint: g(["起点"]).trim(),
    medalImage: g(["奖牌"]).trim(), routeMap: g(["比赛路线"]).trim(),
    regStatus, timeline,
    status: new Date(dateStr) < new Date(new Date().toDateString()) ? "finished" : "upcoming",
    source: "table", sourceSite: "国内路跑认证赛事", sourceUrl: "", sourceId: "",
    publishStatus: "draft", source: "table",
  };
}
function main(){
  const out=[]; const seen=new Set(); let skipped=0;
  for(const [fn, year] of SHEETS){
    const file=path.join(DIR, fn);
    if(!fs.existsSync(file)){ console.log("缺少文件:", fn); continue; }
    const rows=parseCSV(fs.readFileSync(file,"utf8").replace(/^\ufeff/,""));
    const header=rows[0];
    let n=0;
    for(let i=1;i<rows.length;i++){ const r=buildRace(rows[i], header, year); if(!r){ skipped++; continue; } if(seen.has(r.name)){ skipped++; continue; } seen.add(r.name); out.push(r); n++; }
    console.log(fn+": "+n+" 条");
  }
  out.sort((a,b)=> a.date < b.date ? 1 : -1);
  const target = process.argv[2] || path.join(DIR, "races_import.json");
  fs.writeFileSync(target, JSON.stringify(out, null, 1), "utf8");
  console.log("共 "+out.length+" 条, 跳过 "+skipped+" 条, 已输出: "+target);
}
main();
