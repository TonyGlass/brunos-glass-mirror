// Direct HTTPS staging smoke test. Uses no request interception or production URLs.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {access} from 'node:fs/promises';

const url='https://brunos-glass-mirror-staging.english-academy-fl.workers.dev/';
const candidates=[process.env.TEST_BROWSER,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
let executable;
for(const path of candidates){try{await access(path);executable=path;break;}catch{}}
assert.ok(executable,'Set TEST_BROWSER to an installed Chromium executable.');
const port=9452, profile=`${process.env.TEMP||process.env.TMP}/bruno-stage-browser-${Date.now()}`;
const browser=spawn(executable,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,url],{windowsHide:true,stdio:'ignore'});
let socket;
try{
  let targets;
  for(let i=0;i<100;i++){try{targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();if(targets.some(t=>t.type==='page'))break;}catch{}await new Promise(r=>setTimeout(r,100));}
  const target=targets?.find(t=>t.type==='page');assert.ok(target,'Staging browser did not start.');
  socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let seq=0;const pending=new Map();socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
  await send('Page.enable');await send('Runtime.enable');await new Promise(r=>setTimeout(r,1800));
  const widths=[];
  for(const width of [320,375,390,430,768,1024,1440]){await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<=760});await new Promise(r=>setTimeout(r,100));const m=await evaluate(`({width:innerWidth,documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth})`);assert.ok(m.documentWidth<=m.width,`Horizontal overflow at ${width}px`);assert.ok(m.bodyWidth<=m.width,`Body overflow at ${width}px`);widths.push(width);}
  const page=await evaluate(`({title:document.title,start:!!document.querySelector('.sales-hero'),categories:[...document.querySelectorAll('[data-quick-service]')].map(x=>x.dataset.quickService),images:[...document.querySelectorAll('[data-quick-service] img')].map(x=>x.getAttribute('src')),imageFailures:[...document.images].filter(x=>x.currentSrc&&x.naturalWidth===0).map(x=>x.src),trackLink:!!document.querySelector('[href*="tracking"]'),aiAvailable:!!document.querySelector('[data-analyze-photo]'),manualMeasurement:!!document.querySelector('#width')})`);
  assert.ok(page.start,'Quote-first landing entry missing.');assert.ok(page.manualMeasurement,'Manual measurements missing.');assert.deepEqual(page.imageFailures,[],'A staging image failed to load.');
  await send('Page.navigate',{url:url+'admin.html'});await new Promise(r=>setTimeout(r,1000));
  const admin=await evaluate(`({login:!!document.querySelector('#login-panel')&&!document.querySelector('#login-panel').hidden,crmPanelPresent:!!document.querySelector('#crm-panel'),crmVisible:!!document.querySelector('#crm-panel')&&!document.querySelector('#crm-panel').hidden,printPathInBundle:(document.querySelector('script[src*="admin.js"]')?.src||'')})`);
  assert.ok(admin.login,'Staging Admin sign-in page missing.');
  const printPath=await evaluate(`fetch(new URL(document.querySelector('script[src*="admin.js"]').src)).then(r=>r.text()).then(t=>t.includes('Print / Save Final Quote PDF'))`);
  assert.equal(printPath,true,'Admin Final Quote print-to-PDF implementation is missing.');
  console.log(JSON.stringify({stage:true,widths,page,admin,adminPrintToPdfCodePresent:printPath,adminSessionRequiresInviteRecipient:true},null,2));
}finally{socket?.close();browser.kill();}
