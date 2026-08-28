// 国内路跑认证赛事 - 增量更新脚本
// 用法: node update_saishi.js
// 依赖同目录: cookies.txt(登录态), snapshot.json(上次快照,自动生成)
const fs=require("fs");
const zlib=require("zlib");
const path=require("path");
const DIR=__dirname;
const COOKIE_FILE=path.join(DIR,"cookies.txt");
const SNAP_FILE=path.join(DIR,"snapshot.json");
const ID="DQlZpdE1QRFhST0dF";
const SHEETS=[["tHPyTV","2026"],["tg7iI5","2027"],["tbrnPV","2025"],["BB08J2","2024H2"],["t3Lo8Q","2024H1"]];
const CHUNK=60;
function loadCookies(){ try{ const c=fs.readFileSync(COOKIE_FILE,"utf8").trim(); if(!c) throw new Error("empty"); return c; }catch(e){ console.log("[错误] 缺少 cookies.txt，请先扫码登录后重新生成。"); process.exit(1); } }
const COOKIE=loadCookies();
function url(tab,start,end){ return "https://docs.qq.com/dop-api/opendoc?id="+ID+"&tab="+tab+"&startrow="+start+"&endrow="+end+"&normal=1&outformat=1"; }
async function fetchJson(u){ const r=await fetch(u,{headers:{"Cookie":COOKIE,"User-Agent":"Mozilla/5.0","Referer":"https://docs.qq.com/smartsheet/"+ID}}); const txt=await r.text(); if(r.status!==200||!txt||txt.charAt(0)!=="{" ){ if(r.status===401||r.status===403){ const e=new Error("LOGIN_EXPIRED"); e.loginExpired=true; throw e; } throw new Error("请求失败 status="+r.status+" body="+txt.substring(0,120)); } return JSON.parse(txt); }
function normalizeKeys(o){ if(Array.isArray(o)){ o.forEach(normalizeKeys); return o; } if(o&&typeof o==="object"){ for(const k of Object.keys(o)){ const nk=/^\d+$/.test(k)?"k"+k:k; if(nk!==k){ o[nk]=o[k]; delete o[k]; } normalizeKeys(o[nk]); } } return o; }
function collectRecords(all,head,recs){ const cand=[]; if(head&&head.c&&head.c.k2&&head.c.k2.k1) cand.push(head.c.k2.k1); if(recs&&recs.c&&recs.c.k2&&recs.c.k2.k1) cand.push(recs.c.k2.k1); for(const rm of cand){ for(const rid of Object.keys(rm)){ all.records[rid]=rm[rid]; } } if(!all.fieldDefs&&head&&head.c&&head.c.k3&&head.c.k3.k3) all.fieldDefs=head.c.k3.k3; if(!all.refData&&head&&head.c&&head.c.k3) all.refData=head.c.k3; }
async function getRev(tab){ const o=await fetchJson(url(tab,0,1)); const ccv=o.clientVars&&o.clientVars.collab_client_vars||{}; return ccv.rev||0; }
async function extractSheet(tab){ const first=await fetchJson(url(tab,0,1)); const ccv0=first.clientVars&&first.clientVars.collab_client_vars||{}; const maxRow=ccv0.maxRow||0; const all={fieldDefs:null,refData:null,records:{}}; for(let start=0;start<maxRow;start+=CHUNK){ const end=Math.min(start+CHUNK,maxRow); const o=await fetchJson(url(tab,start,end)); const ccv=o.clientVars&&o.clientVars.collab_client_vars||{}; const iat=ccv.initialAttributedText; if(!iat||!iat.text) continue; const textArr=Array.isArray(iat.text)?iat.text:[iat.text]; for(const ch of textArr){ if(!ch||!ch.smartsheet) continue; const data=normalizeKeys(JSON.parse(ch.smartsheet.charAt(0)==="["?ch.smartsheet:zlib.inflateSync(Buffer.from(ch.smartsheet,"base64")).toString("utf8"))); const items=Array.isArray(data)?data:[data]; for(const inner of items){ const head=Array.isArray(inner)?inner[0]:(inner.head||null); const recs=Array.isArray(inner)?inner[1]:(inner.records||null); collectRecords(all,head,recs); } } } return all; }
function csvF(s){ s=String(s==null?"":s); if(/[",\n\r]/.test(s)){ return "\""+s.replace(/"/g,"\"\"")+"\""; } return s; }
function fmtDate(ms){ if(ms==null||ms==="") return ""; const d=new Date(Number(ms)); if(isNaN(d.getTime())) return ""; const p=n=>String(n).padStart(2,"0"); return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate())+" "+p(d.getHours())+":"+p(d.getMinutes()); }
function richText(v){ if(v&&Array.isArray(v.k1)) return v.k1.map(x=>x.k2!=null?x.k2:(x.k3||"")).join(""); return ""; }
function refNames(optArr,ids){ if(!Array.isArray(ids)) return ""; const map={}; if(Array.isArray(optArr)) for(const o of optArr){ if(o&&o.k1!=null) map[o.k1]=o.k2; } return ids.map(id=>map[id]!=null?map[id]:id).join(" / "); }
function extractValue(fd,v){ if(!v) return ""; const type=fd?fd.k31:null; switch(type){
  case 1: return richText(v);
  case 2: return v.k2!=null?String(v.k2):"";
  case 4: return fmtDate(v.k4);
  case 5: { if(Array.isArray(v.k5)) return v.k5.map(x=>{ if(x&&typeof x==="object") return x.k3||x.k2||""; return String(x); }).join(", "); if(v.k5!=null&&typeof v.k5==="object"&&("k1" in v.k5)) return String(v.k5.k1); if(v.k5!=null) return String(v.k5); return ""; }
  case 8: { if(Array.isArray(v.k8)) return v.k8.map(x=>x.k3||x.k2||"").join(", "); return ""; }
  case 9: return refNames(fd&&fd.k9&&fd.k9.k3,v.k9);
  case 12: return fmtDate(v.k12||v.k4);
  case 13: return fmtDate(v.k13||v.k4);
  case 15: return v.k15!=null?String(v.k15):"";
  case 16: return v.k16!=null?String(v.k16):"";
  case 17: return refNames(fd&&fd.k17&&fd.k17.k3,v.k17);
  case 19: { if(v.k36&&v.k36.k1){ try{ const o=JSON.parse(v.k36.k1); if(o&&o.data&&Array.isArray(o.data)) return o.data.map(x=>x.text||"").join(""); }catch(e){} } return ""; }
  case 22: { if(Array.isArray(v.k22)) return v.k22.map(x=>x.k2||"").join(", "); return ""; }
  default: { const keys=Object.keys(v).filter(k=>/^k\d+$/.test(k)&&k!=="k30"&&k!=="k31"&&k!=="k32"); return keys.map(k=>{ const val=v[k]; if(val==null) return ""; if(typeof val==="string") return val; if(typeof val==="number") return String(val); if(Array.isArray(val)) return val.map(y=>y&&y.k2!=null?y.k2:(y.k3||(typeof y==="string"?y:""))).join(" / "); if(typeof val==="object") return val.k2!=null?String(val.k2):""; return ""; }).filter(Boolean).join(" | "); }
  }
}
function fieldOrder(sheet){ let order=(sheet.refData&&sheet.refData.k12&&sheet.refData.k12.k2&&sheet.refData.k12.k2.k1)||[]; if(!order.length) order=Object.keys(sheet.fieldDefs||{}); return order; }
function buildCsv(tab,sheet,name){
  const fd=sheet.fieldDefs||{};
  const order=fieldOrder(sheet);
  const headers=order.map(fid=>fd[fid]?fd[fid].k30:(fid));
  const lines=[headers.map(csvF).join(",")];
  for(const rid of Object.keys(sheet.records)){ const rv=sheet.records[rid]; const fields=(rv&&rv.k1)||{}; lines.push(order.map(fid=>extractValue(fd[fid],fields[fid])).map(csvF).join(",")); }
  const fn=path.join(DIR,"路跑赛事_"+name+".csv");
  fs.writeFileSync(fn,"\ufeff"+lines.join("\r\n"),"utf8");
  console.log("  CSV: "+path.basename(fn)+" ("+(Object.keys(sheet.records).length)+" 行)");
}
function recName(sheet,rid){
  const rv=sheet.records[rid]; if(!rv||!rv.k1) return rid;
  const fd=sheet.fieldDefs||{};
  let nameField=null;
  for(const fid of Object.keys(fd)){ const n=fd[fid].k30; if(n==="赛事"||n==="赛事名称"){ nameField=fid; break; } }
  if(nameField){ const v=extractValue(fd[nameField],rv.k1[nameField]); if(v) return v; }
  for(const fid of Object.keys(rv.k1)){ const v=extractValue(fd[fid],rv.k1[fid]); if(v&&fd[fid]&&fd[fid].k31===1) return v.substring(0,40); }
  return rid;
}
function diffSheets(oldSnap,newSnap){
  const report={};
  for(const [tab,name] of SHEETS){
    const oldRecs=(oldSnap&&oldSnap.sheets&&oldSnap.sheets[tab]&&oldSnap.sheets[tab].records)||{};
    const newRecs=newSnap.sheets[tab].records;
    const oldStr={},newStr={}; for(const r of Object.keys(oldRecs)) oldStr[r]=JSON.stringify(oldRecs[r]); for(const r of Object.keys(newRecs)) newStr[r]=JSON.stringify(newRecs[r]);
    const added=[],changed=[],deleted=[];
    for(const rid of Object.keys(newStr)){ if(!(rid in oldStr)) added.push(rid); else if(oldStr[rid]!==newStr[rid]) changed.push(rid); }
    for(const rid of Object.keys(oldStr)){ if(!(rid in newStr)) deleted.push(rid); }
    report[tab]={name,added,changed,deleted};
  }
  return report;
}
async function main(){
  console.log("== 检查版本号(rev) ==");
  const revs={};
  for(const [tab,name] of SHEETS){
    try{ revs[tab]=await getRev(tab); console.log("  "+name+": rev="+revs[tab]); }catch(e){ if(e.loginExpired){ console.log("[提示] 登录态已失效，请重新扫码登录后更新 cookies.txt 再运行。"); process.exit(1); } throw e; }
  }
  let oldSnap=null; try{ oldSnap=JSON.parse(fs.readFileSync(SNAP_FILE,"utf8")); }catch(e){}
  if(oldSnap&&oldSnap.revs){ const same=Object.keys(revs).every(t=>oldSnap.revs[t]===revs[t]); if(same){ console.log("== 无更新：所有子表版本号与上次一致 =="); return; } }
  console.log("== 检测到更新，开始全量拉取 ==");
  const sheets={};
  for(const [tab,name] of SHEETS){
    const s=await extractSheet(tab); sheets[tab]=s; console.log("  "+name+": "+Object.keys(s.records).length+" 条");
  }
  const newSnap={revs,sheets,updatedAt:new Date().toISOString()};
  if(oldSnap&&oldSnap.sheets){
    const report=diffSheets(oldSnap,newSnap);
    console.log("== 变更明细 ==");
    let totalA=0,totalC=0,totalD=0;
    for(const [tab,r] of Object.entries(report)){ totalA+=r.added.length; totalC+=r.changed.length; totalD+=r.deleted.length;
      console.log("  "+r.name+": 新增 "+r.added.length+" / 修改 "+r.changed.length+" / 删除 "+r.deleted.length);
      for(const rid of r.added) console.log("    [新增] "+recName(sheets[tab],rid));
      for(const rid of r.deleted) console.log("    [删除] "+rid);
    }
    console.log("== 合计: 新增 "+totalA+" / 修改 "+totalC+" / 删除 "+totalD+" ==");
  } else { console.log("== 首次运行（无旧快照），全量生成 =="); }
  fs.writeFileSync(SNAP_FILE,JSON.stringify(newSnap));
  console.log("快照已保存: snapshot.json");
  console.log("== 重新生成 CSV ==");
  for(const [tab,name] of SHEETS) buildCsv(tab,sheets[tab],name);
  console.log("== 完成 ==");
}
main().catch(e=>{ console.log("出错: "+e.message); process.exit(1); });
