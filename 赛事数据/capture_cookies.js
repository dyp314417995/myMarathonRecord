const http=require("http");
const fs=require("fs");
const PORT=process.argv[2]||9225;
const OUT=process.argv[3]||(__dirname+"/cookies.txt");
function getJson(url){ return new Promise((res,rej)=>{ http.get(url,r=>{ let d=""; r.on("data",c=>d+=c); r.on("end",()=>{ try{res(JSON.parse(d))}catch(e){rej(e)} }); }).on("error",rej); }); }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
async function evalIn(page,expr){
  const ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ ws.onopen=res; ws.onerror=rej; });
  let id=0; const pend={};
  const send=(m,p)=>new Promise((res,rej)=>{ const i=++id; pend[i]={res,rej}; ws.send(JSON.stringify({id:i,method:m,params:p||{}})); });
  ws.onmessage=ev=>{ const m=JSON.parse(ev.data); if(m.id&&pend[m.id]){ pend[m.id].res(m.result); delete pend[m.id]; } };
  const r=await send("Runtime.evaluate",{expression:expr,returnByValue:true});
  ws.close(); return r&&r.result&&r.result.value;
}
async function main(){
  console.log("等待浏览器...");
  let page=null;
  for(let i=0;i<30;i++){ try{ const ts=await getJson("http://127.0.0.1:"+PORT+"/json/list"); page=ts.find(t=>t.type==="page"); if(page) break; }catch(e){} await sleep(1000); }
  if(!page){ console.log("[错误] 找不到浏览器页面"); process.exit(1); }
  console.log("请在浏览器窗口扫码登录（如需点击「微信登录」请手动点）。");
  for(let i=0;i<150;i++){
    try{
      const cookie=await evalIn(page,"document.cookie");
      if(cookie&&cookie.indexOf("uid_key=")>=0){
        fs.writeFileSync(OUT,cookie,"utf8");
        console.log("[成功] 登录态已保存到 cookies.txt，现在可以运行: node update_saishi.js");
        process.exit(0);
      }
    }catch(e){}
    await sleep(2000);
  }
  console.log("[超时] 5分钟内未检测到登录"); process.exit(1);
}
main().catch(e=>{ console.log("[错误] "+e.message); process.exit(1); });
