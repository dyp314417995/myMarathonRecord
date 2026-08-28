// CSV → race_events 标准化对象（按新字段模型）
// 用法: node csv-to-races.js [输出json路径]
const fs = require("fs");
const path = require("path");
const DIR = __dirname;
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
    name: finalName, raceGroup, date: dateStr, province: g(["省份"]).trim(), city: "",
    raceTypes: parseTypes(g(["比赛项目"])), raceLevel: parseLevel(levelTxt), label: parseLabel(levelTxt),
    scale: num(g(["总规模"])), subScale: g(["分项规模"]).trim(), fee: g(["报名费"]).trim(),
    organizer: g(["主办单位"]).trim(), operator: g(["运营单位"]).trim(),
    contactPhone: g(["联系电话"]).trim(), contactEmail: g(["官方邮箱"]).trim(), wechatAccount: g(["微信公众号"]).trim(), website: g(["官网"]).trim(),
    mechanism: parseMechanism(g(["抽签"])), payment: "", signupChannels: g(["报名渠道"]).trim(),
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
