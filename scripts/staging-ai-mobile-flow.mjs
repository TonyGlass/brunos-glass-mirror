// Exercises the real staging quotation UI and analyzer from a mobile-sized browser.
// It prints no browser logs, runtime configuration, credentials, or image data.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {access} from 'node:fs/promises';
import {resolve} from 'node:path';

const origin='https://brunos-glass-mirror-staging.english-academy-fl.workers.dev';
const candidates=[process.env.TEST_BROWSER,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
let executable;
for(const path of candidates){try{await access(path);executable=path;break;}catch{}}
assert.ok(executable,'Set TEST_BROWSER to an installed Chromium executable.');
const port=9462,profile=`${process.env.TEMP||process.env.TMP}/bruno-stage-ai-mobile-${Date.now()}`;
const browser=spawn(executable,['--headless=new','--disable-gpu','--disable-gpu-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-first-run','--no-default-browser-check','--disable-background-networking',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,`${origin}/#quote`],{windowsHide:true,stdio:'ignore'});
let socket;
try{
  let targets;
  for(let i=0;i<100;i++){try{targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();if(targets.some(t=>t.type==='page'))break;}catch{}await new Promise(r=>setTimeout(r,100));}
  const target=targets?.find(t=>t.type==='page');assert.ok(target,'Staging mobile browser did not start.');
  socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let seq=0;const pending=new Map();socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;};
  await send('Page.enable');await send('Runtime.enable');await send('DOM.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await new Promise(r=>setTimeout(r,1800));
  const width=await evaluate(`({viewport:innerWidth,document:document.documentElement.scrollWidth,photoAccept:document.querySelector('#photos').accept,hasCamera:!!document.querySelector('[data-scan-camera]')})`);
  assert.ok(width.document<=width.viewport,'No horizontal overflow at mobile width.');
  assert.match(width.photoAccept,/image\/jpeg/,'Phone JPEG upload is accepted.');
  await evaluate(`(()=>{const service=document.querySelector('#service');service.value='Shower Doors';service.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await new Promise(r=>setTimeout(r,300));
  await evaluate(`(()=>{const product=document.querySelector('#product');product.value='';product.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const chooser=await send('DOM.getDocument');
  const input=await send('DOM.querySelector',{nodeId:chooser.root.nodeId,selector:'#photos'});
  assert.ok(input.nodeId,'Photo input exists in the staging quote wizard.');
  await send('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[resolve('images/reference/shower-tub.jpg')]});
  await evaluate(`document.querySelector('#photos').dispatchEvent(new Event('change',{bubbles:true}))`);
  await new Promise(r=>setTimeout(r,350));
  await evaluate(`document.querySelector('[data-analyze-photo]').click()`);
  for(let i=0;i<150;i++){
    const done=await evaluate(`document.querySelector('.scan-result-status').textContent.includes('unavailable')||document.querySelector('[data-vision-result]').hidden===false`);
    if(done)break;await new Promise(r=>setTimeout(r,200));
  }
  await evaluate(`Promise.all([...document.querySelectorAll('[data-vision-result] img')].map(img=>img.decode().catch(()=>false)))`);
  const analysis=await evaluate(`({status:document.querySelector('.scan-result-status').textContent,visible:!document.querySelector('[data-vision-result]').hidden,result:document.querySelector('[data-vision-result]').textContent,geometry:[...document.querySelectorAll('[data-vision-result] p')].find(p=>p.textContent.startsWith('Opening geometry:'))?.textContent||'',examples:[...document.querySelectorAll('[data-vision-result] img')].map(img=>({src:img.getAttribute('src'),alt:img.alt,loaded:img.complete&&img.naturalWidth>0})),captions:[...document.querySelectorAll('[data-vision-result] figcaption')].map(el=>el.textContent),measurements:{width:document.querySelector('#width').value,height:document.querySelector('#height').value},editable:!document.querySelector('#width').readOnly&&!document.querySelector('#height').readOnly,selected:document.querySelector('#product').value})`);
  assert.equal(analysis.editable,true,'Tape measurements remain editable after analysis.');
  if(analysis.visible){
    assert.match(analysis.result,/Likely project: Shower Glass/,'Real analysis should classify the shower photo.');
    assert.match(analysis.geometry,/Straight bathtub \/ alcove|Opening geometry unclear/,'A tub photo must be classified as straight tub/alcove or safely unclear.');
    if(analysis.geometry.includes('Straight bathtub')){
      assert.match(analysis.captions[0]||'',/^Best match: Tub Enclosure/,'Straight tub best match must be Tub Enclosure.');
      assert.match(analysis.captions[1]||'',/^Alternative: Sliding Door/,'Straight tub alternative must be Sliding Door.');
      assert.equal(analysis.captions.length,2,'Straight tub returns only its two supported catalog choices.');
      assert.ok(analysis.examples.every(item=>item.src.includes('shower-tub.jpg')||item.src.includes('tub-sliding.svg')),'Straight tub recommendations must use tub-matched imagery.');
    }else{
      assert.deepEqual(analysis.captions,['Your photo — Bruno to review'],'Unclear geometry may only show Not Sure with the customer photo.');
    }
    assert.ok(analysis.examples.every(item=>item.loaded),'Every geometry-matched recommendation image should load.');
    assert.equal(analysis.selected,'','AI recommendations must not change the selected configuration automatically.');
    await evaluate(`document.querySelector('[data-vision-result] button').click()`);
    assert.ok(await evaluate(`document.querySelector('#product').value`),'Customer can explicitly select a recommendation.');
  }else assert.match(analysis.status,/temporarily unavailable|unavailable/i,'Provider failures must fall back with a clear manual path.');
  const measurementState=await evaluate(`({width:document.querySelector('#width').value,height:document.querySelector('#height').value,aiLabelVisible:document.querySelector('[data-ai-estimate-label]').checkVisibility(),confirmationVisible:document.querySelector('[data-ai-confirmation]').checkVisibility(),confirmationChecked:document.querySelector('[data-confirm-ai-measurement]').checked,confidence:document.querySelector('[data-scan-quality]').textContent,editable:!document.querySelector('#width').readOnly&&!document.querySelector('#height').readOnly})`);
  if(measurementState.width||measurementState.height){
    assert.ok(measurementState.width&&measurementState.height,'AI must populate Width and Height as a pair.');
    assert.equal(measurementState.aiLabelVisible,true,'Numerical AI dimensions are labeled approximate and AI estimated.');
    assert.equal(measurementState.confirmationVisible,true,'AI dimensions require customer confirmation before submission.');
    assert.equal(measurementState.confirmationChecked,false,'AI dimensions remain unconfirmed after analysis.');
    assert.match(measurementState.confidence,/confidence|%/i,'AI measurement confidence is displayed.');
    await evaluate(`document.querySelector('[data-confirm-ai-measurement]').click()`);
    assert.equal(await evaluate(`QuoteMeasurement.isConfirmed()`),true,'The customer may explicitly confirm AI dimensions.');
  }else{
    assert.equal(measurementState.aiLabelVisible,false,'Unavailable dimensions are not mislabeled as AI estimates.');
    assert.equal(measurementState.confirmationVisible,false,'No confirmation is required for absent AI dimensions.');
    await evaluate(`(()=>{for(const [id,value] of [['width','60'],['height','72']]){const el=document.getElementById(id);el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
    assert.equal(await evaluate(`document.querySelector('#width').value==='60'&&document.querySelector('#height').value==='72'`),true,'Manual measurement remains available when AI cannot estimate scale.');
  }
  await new Promise(r=>setTimeout(r,1800));
  const estimate=await evaluate(`({price:document.querySelector('#estimated-price-value').textContent.trim(),base:document.querySelector('[data-estimate-base]').textContent.trim(),deposit:document.querySelector('[data-estimate-deposit]').textContent.trim(),configuration:document.querySelector('#product').value})`);
  console.log(JSON.stringify({stagingUrl:origin,mobileWidth:width.viewport,photoAccept:width.photoAccept,cameraCaptureAvailable:width.hasCamera,analysisStatus:analysis.status,classification:analysis.visible?'Shower Glass':null,detectedGeometry:analysis.geometry,recommendations:analysis.captions,recommendationImages:analysis.examples,measurements:{width:measurementState.width,height:measurementState.height,aiEstimated:measurementState.aiLabelVisible,confirmationRequired:measurementState.confirmationVisible,confidence:measurementState.confidence,editable:measurementState.editable},estimate},null,2));
}finally{socket?.close();browser.kill();}
