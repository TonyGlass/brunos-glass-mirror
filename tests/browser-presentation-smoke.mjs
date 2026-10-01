import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

const port = Number(process.env.PRESENTATION_CDP_PORT || 9444);
const localOrigin = `http://127.0.0.1:${process.env.PRESENTATION_HTTP_PORT || 8766}`;
const endpoint = `http://127.0.0.1:${port}/json/list`;
const targets = await (await fetch(endpoint)).json();
const target = targets.find(item => item.type === 'page' && item.url.startsWith(localOrigin + '/index.html'));
assert.ok(target, 'Open the local presentation in headless Edge with remote debugging enabled first.');

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, {once:true});
  socket.addEventListener('error', reject, {once:true});
});
let sequence = 0;
const waiting = new Map();
const exceptions = [];
const consoleErrors = [];
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id && waiting.has(message.id)) {
    const entry = waiting.get(message.id);
    waiting.delete(message.id);
    if (message.error) entry.reject(Error(message.error.message));
    else entry.resolve(message.result);
    return;
  }
  if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    consoleErrors.push(message.params.args.map(arg => arg.value || arg.description || '').join(' '));
  }
});
function send(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve,reject) => {
    waiting.set(id,{resolve,reject});
    socket.send(JSON.stringify({id,method,params}));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
await new Promise(resolve => setTimeout(resolve,1200));
await evaluate(`(async()=>{for(const image of document.images){if(image.src.startsWith(location.origin)){image.loading='eager';}}await Promise.all([...document.images].filter(image=>image.src.startsWith(location.origin)).map(image=>image.decode().catch(()=>false)));return true})()`);

const viewportResults = [];
for (const width of [320,375,768,1024,1440]) {
  await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<=760});
  const metrics = await evaluate(`({width:innerWidth,documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,hero:!!document.querySelector('.sales-hero'),serviceCards:document.querySelectorAll('.featured-project').length,services:document.querySelectorAll('.service-index-grid a').length,quote:!!document.querySelector('#quote-form'),photos:!!document.querySelector('#photos'),qrCards:document.querySelectorAll('.qr-card').length,images:[...document.querySelectorAll('img[src^="images/"]')].every(image=>image.complete&&image.naturalWidth>0),nav:getComputedStyle(document.querySelector('#site-nav')).display,referral:document.querySelector('#quote-referral-note')?.textContent,doorImage:document.querySelector('[data-project-reference-image]').src.includes('/reference/glass-doors.jpg')})`);
  assert.ok(metrics.documentWidth<=metrics.width,`No horizontal overflow at ${width}px`);
  assert.ok(metrics.hero && metrics.quote && metrics.photos && metrics.images,`Core content and local imagery load at ${width}px`);
  assert.equal(metrics.services,7);
  assert.equal(metrics.serviceCards,5);
  assert.equal(metrics.qrCards,3);
  assert.equal(metrics.referral,'Referred by Jeff');
  viewportResults.push({width,overflow:false,nav:metrics.nav,imagesLoaded:metrics.images});
}

await send('Emulation.setDeviceMetricsOverride',{width:320,height:850,deviceScaleFactor:1,mobile:true});
const menu = await evaluate(`(()=>{document.querySelector('.menu-toggle').click();const open=getComputedStyle(document.querySelector('#site-nav')).display==='flex'&&document.querySelector('.menu-toggle').getAttribute('aria-expanded')==='true';document.querySelector('.menu-toggle').click();return open})()`);
assert.equal(menu,true,'Mobile navigation opens and exposes its state.');
const reducedMotion = await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
assert.ok(reducedMotion);
assert.equal(await evaluate(`matchMedia('(prefers-reduced-motion: reduce)').matches`),true);

await evaluate(`document.querySelector('.entry-showers [data-quick-product="Sliding Door"]').click()`);
assert.equal(await evaluate(`document.querySelector('#service').value`),'Shower Doors','Shower category starts the matching service.');
assert.equal(await evaluate(`document.querySelector('#product').value`),'Sliding Door','Shower choice preselects only its physical configuration.');
assert.equal(await evaluate(`document.querySelector('#glass-type').value`),'','Configuration leaves material independent.');
assert.equal(await evaluate(`document.querySelector('#wizard-step-name').textContent`),'Scan / Measure Space');
await evaluate(`(()=>{document.querySelector('[data-jump-step="1"]').click();const s=document.querySelector('#service');s.value='';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
await evaluate(`document.querySelector('.entry-mirrors .entry-card').click()`);
assert.equal(await evaluate(`document.querySelector('#service').value`),'Mirror','Mirror category starts the mirror flow.');
assert.equal(await evaluate(`document.querySelector('#mirror-layout').value`),'Vanity / Bathroom Mirror','Mirror card preselects its placement only.');
assert.equal(await evaluate(`document.querySelector('#wizard-step-name').textContent`),'Scan / Measure Space');
await evaluate(`(()=>{document.querySelector('[data-jump-step="1"]').click();const s=document.querySelector('#service');s.value='';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
await evaluate(`document.querySelector('.entry-architectural .entry-card').click()`);
assert.equal(await evaluate(`document.body.dataset.quoteMode`),'custom','Architectural glass starts a custom review request.');
assert.equal(await evaluate(`document.querySelector('#custom-quote-selection-name').textContent`),'Commercial Interior Glazing / Glass Partitions');
assert.equal(await evaluate(`document.querySelector('#wizard-step-name').textContent`),'Measurements');
assert.match(await evaluate(`document.querySelector('#estimated-price-value').textContent`),/Custom quote|estimate prepared after review/,'No automatic custom price is shown.');
assert.doesNotMatch(await evaluate(`document.querySelector('#estimated-price-value').textContent`),/\$\s?\d/,'Custom glass has no invented estimate.');
await evaluate(`document.querySelector('[data-change-quote-service]').click()`);
assert.equal(await evaluate(`document.querySelector('#wizard-step-name').textContent`),'Project Type');

let responsiveStepChecks = 0;
async function checkStepLayouts() {
  for (const width of [320,375,768,1024,1440]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<=760});
    const metrics = await evaluate(`({width:innerWidth,content:document.documentElement.scrollWidth,step:document.querySelector('#wizard-step-name').textContent})`);
    assert.ok(metrics.content<=metrics.width,`${metrics.step} fits ${width}px`);
    responsiveStepChecks++;
  }
  await send('Emulation.setDeviceMetricsOverride',{width:375,height:900,deviceScaleFactor:1,mobile:true});
}
const next = async () => { await evaluate(`document.querySelector('.wizard-step-panel:not([hidden]) .wizard-next').click()`); await checkStepLayouts(); };
const setFields = values => evaluate(`(()=>{for(const [id,value] of ${JSON.stringify(values)}){const node=document.getElementById(id);node.value=value;node.dispatchEvent(new Event(node.tagName==='INPUT'?'input':'change',{bubbles:true}));}})()`);
const step = () => evaluate(`document.querySelector('#wizard-step-name').textContent`);
const pause = () => new Promise(resolve => setTimeout(resolve,350));
await evaluate(`window.__mockRequests=[];window.fetch=async(input,init={})=>{const body=JSON.parse(init.body||'{}');window.__mockRequests.push(body);const estimate={complete:true,low:1800,high:1800,revision:2,breakdown:{material:1500,frame:300,enduroShield:0}};return new Response(JSON.stringify(body.action==='estimate'?{estimate}:body.action==='create'?{uploads:(body.files||[]).map((file,i)=>({path:'local/'+i,token:'local'})),finalizeToken:'local-only',trackingNumber:'BGM-LOCAL-1',accessCode:'local-test-code'}:{ok:true}),{status:200,headers:{'content-type':'application/json'}})};`);
await next();
assert.equal(await step(),'Project Type','Missing project cannot advance.');
await evaluate(`document.querySelector('[data-value="Shower Doors"]').click()`);
await next();
assert.equal(await step(),'Scan / Measure Space');
assert.equal(await evaluate(`document.body.classList.contains('quote-app-active')`),true);
assert.equal(await evaluate(`document.querySelector('.sales-hero').checkVisibility()`),false,'Quotation entry hides marketing without deleting it.');
assert.equal(await evaluate(`[...document.querySelectorAll('.official-logo')].filter(n=>n.checkVisibility()).length`),1,'One branded header in quotation mode.');
assert.equal(await evaluate(`document.querySelector('#photos').closest('.wizard-step-panel').hidden`),false,'Photos are available alongside measurements.');
assert.equal(await evaluate(`(()=>{const input=document.querySelector('#photos');const original=input.click;let capture;input.click=()=>{capture=input.getAttribute('capture')};document.querySelector('[data-scan-camera]').click();input.click=original;document.querySelector('[data-scan-upload]').click();return capture==='environment'&&document.activeElement.id==='width'&&input.getAttribute('capture')===null})()`),true,'Camera opens photo selection; manual mode focuses editable measurements.');
await setFields([['width','60 1/3'],['height','72']]);
await next();
assert.equal(await step(),'Scan / Measure Space','Invalid fractions cannot advance.');
await setFields([['width','67 5/8'],['height','95 1/16']]);
await evaluate(`(()=>{const files=new DataTransfer();files.items.add(new File(['local image'],'opening.png',{type:'image/png'}));document.querySelector('#photos').files=files.files;document.querySelector('#photos').dispatchEvent(new Event('change',{bubbles:true}));})()`);
await pause();
assert.match(await evaluate(`document.querySelector('.scan-result-status').textContent`),/Photo ready.*Select Analyze photo/);
assert.equal(await evaluate(`document.querySelector('.scan-dimensions').hidden`),true);
assert.equal(await evaluate(`document.querySelector('#width').value`),'67 5/8','Unavailable provider leaves entered fractions alone.');
await setFields([['opening-placement','tub']]);
await next();
assert.equal(await step(),'Shower Configuration');
assert.match(await evaluate(`document.querySelector('.configuration-recommendation').textContent`),/Recommended for your space: Tub Enclosure/);
assert.equal(await evaluate(`document.querySelector('#product').value`),'','Recommendation does not select a layout for the customer.');
assert.equal(await evaluate(`[...document.querySelectorAll('.mirror-configuration img')].some(n=>n.checkVisibility())`),false);
assert.ok(await evaluate(`[...document.querySelectorAll('[data-choice-list-for="product"] img')].every(n=>n.src.includes('/images/reference/shower-'))`),'Only shower reference photos appear in shower configuration.');
assert.equal(await evaluate(`document.querySelectorAll('[data-choice-list-for="product"] button').length`),6);
await next();
assert.equal(await step(),'Shower Configuration','A shower layout is required.');
await evaluate(`document.querySelector('[data-choice-list-for="product"] button').click()`);
assert.equal(await evaluate(`document.querySelector('#door-type').value`),'Sliding Door');
await next();
assert.equal(await step(),'Glass & Hardware Options');
await setFields([['glass-type','Low-Iron Glass - 3/8']]);
await next(); await pause();
assert.equal(await step(),'Live Estimate');
assert.equal(await evaluate(`document.querySelector('#estimated-price-value').textContent`),'$1,800.00 – $1,950.00');
await evaluate(`document.querySelector('#quote').scrollIntoView()`);
await writeFile(new URL('../.wrangler/configurator-mobile.png',import.meta.url),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
await next();
assert.equal(await step(),'Customer Information');
await setFields([['name','<b>Demo Customer</b>'],['phone','9545550100'],['email','invalid'],['city','Hollywood']]);
await next();
assert.equal(await step(),'Customer Information','Invalid email cannot advance.');
await setFields([['email','demo@example.com']]);
await next();
assert.equal(await step(),'Review & Submit');
assert.equal(await evaluate(`!!document.querySelector('.quote-review-summary b')`),false,'Customer text is never interpreted as markup.');
assert.match(await evaluate(`document.querySelector('.quote-review-summary').textContent`),/67 5\/8 × 95 1\/16 in/);
assert.match(await evaluate(`document.querySelector('.quote-review-summary').textContent`),/opening.png/);
assert.equal(await evaluate(`document.querySelectorAll('[id]').length===new Set([...document.querySelectorAll('[id]')].map(n=>n.id)).size`),true,'No duplicate IDs after rearranging the form.');
await evaluate(`document.querySelector('[data-cart-add]').click()`);
assert.equal(await evaluate(`ProjectCartPreview.getItems()[0].estimateLabel`),'$1,800.00 – $1,950.00');
await setFields([['project','Local browser test only.']]);
await evaluate(`document.querySelector('#quote-form button[type="submit"]').click()`); await pause();
const shower = await evaluate(`({quote:window.__mockRequests.find(r=>r.action==='create').quote,uploads:window.__uploads,confirmed:!document.querySelector('#request-confirmation').hidden})`);
assert.equal(shower.confirmed,true);
assert.equal(await evaluate(`document.querySelector('#request-order-number').textContent`),'BGM-LOCAL-1','Order number is exactly the backend fixture response.');
assert.equal(await evaluate(`document.querySelector('#request-tracking-access-code').textContent`),'local-test-code','Access code is exactly the backend fixture response.');
assert.equal(shower.quote.width,67.625);
assert.equal(shower.quote.height,95.0625);
assert.equal(shower.quote.final_price,null);
assert.equal(shower.quote.estimated_price_high,1800,'Display allowance is not saved as base pricing.');
assert.equal(shower.uploads[0].name,'opening.png');
assert.equal(await evaluate(`document.querySelector('.scan-photo-status').textContent`),'','Uploaded attachments no longer appear selected.');

// Re-enter from the main CTA; changing services keeps their controls separate.
await evaluate(`document.querySelector('[data-start-project]').click();document.querySelector('[data-value="Mirror"]').click()`);
await next(); await next();
assert.equal(await step(),'Mirror Configuration');
assert.equal(await evaluate(`[...document.querySelectorAll('[data-choice-list-for="product"] img')].some(n=>n.checkVisibility())`),false,'Mirror never shows shower cards.');
await setFields([['mirror-layout','Wall Mirror']]);
await next();
assert.equal(await evaluate(`document.querySelector('#mirror-frame').checkVisibility()`),true,'Mirror frame belongs in Options.');
await setFields([['glass-type','Clear Mirror - 1/4'],['mirror-frame','yes']]);
await next(); await pause();
const breakdowns = await evaluate(`[...document.querySelectorAll('[data-estimate-breakdown]')].map(n=>({hidden:n.hidden,text:n.textContent}))`);
assert.equal(breakdowns.length,2);
assert.ok(breakdowns.every(n=>!n.hidden && n.text.includes('Metal / Frame: $300.00')),'Live and review breakdowns agree.');
await next(); await next();
assert.match(await evaluate(`document.querySelector('.quote-review-summary').textContent`),/Wall Mirror/);
await evaluate(`window.__mockRequests=[];document.querySelector('#quote-form button[type="submit"]').click()`); await pause();
assert.match(await evaluate(`window.__mockRequests.find(r=>r.action==='create').quote.message`),/Mirror placement: Wall Mirror/);
await evaluate(`document.querySelector('[data-start-project]').click();document.querySelector('[data-value="Glass"]').click()`);
await next(); await next();
assert.equal(await step(),'Glass Configuration');
assert.equal(await evaluate(`document.querySelector('#mirror-frame').value`),'no');
await next();
assert.equal(await evaluate(`document.querySelector('#mirror-frame-group').hidden`),true);
assert.equal(await evaluate(`document.querySelector('#glass-type').value`),'');

// Custom cards inside the configurator also work after removing the old modal.
await evaluate(`document.querySelector('[data-jump-step="1"]').click();document.querySelector('.service-options [data-custom-service]').click()`);
assert.equal(await evaluate(`document.body.dataset.quoteMode`),'custom');
await evaluate(`document.querySelector('[data-change-quote-service]').click()`);
assert.equal(await evaluate(`document.querySelector('#service').value`),'');

await evaluate(`(()=>{document.querySelector('a[data-custom-service]').click();return true})()`);
assert.deepEqual(await evaluate(`({mode:document.body.dataset.quoteMode,step:document.querySelector('#wizard-step-count').textContent,service:document.querySelector('#custom-quote-selection-name').textContent,price:document.querySelector('#estimated-price-value').textContent,materialHidden:document.querySelector('#glass-type-group').hidden,upload:!!document.querySelector('#photos')})`),{
  mode:'custom',step:'STEP 1 OF 4',service:'Glass Door',
  price:'Custom quote — estimate prepared after review.',materialHidden:true,upload:true
});
await evaluate(`(()=>{for(const [id,value] of [['width','60'],['height','72']]){const input=document.querySelector('#'+id);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));}document.querySelector('.wizard-step-panel:not([hidden]) .wizard-next').click();return true})()`);
assert.equal(await evaluate(`document.querySelector('#wizard-step-count').textContent`),'STEP 2 OF 4');
await evaluate(`(()=>{for(const [id,value] of [['name','Demo Customer'],['phone','9545550100'],['email','demo@example.com'],['city','Hollywood']])document.querySelector('#'+id).value=value;document.querySelector('.wizard-step-panel:not([hidden]) .wizard-next').click();document.querySelector('#project').value='Local browser smoke test only.';document.querySelector('.wizard-step-panel:not([hidden]) .wizard-next').click();return true})()`);
assert.equal(await evaluate(`document.querySelector('#wizard-step-count').textContent`),'STEP 4 OF 4');
await evaluate(`(()=>{window.__mockRequests=[];window.fetch=async(input,init={})=>{const url=String(input);const body=JSON.parse(init.body||'{}');window.__mockRequests.push({url,body});if(url.endsWith('/pricing'))return new Response(JSON.stringify({estimate:{complete:false,reason:'pricing_unavailable',revision:2}}),{status:200,headers:{'content-type':'application/json'}});if(url.endsWith('/submit-quote'))return new Response(JSON.stringify(body.action==='create'?{uploads:[],finalizeToken:'local-only'}:{ok:true}),{status:200,headers:{'content-type':'application/json'}});throw Error('Unexpected browser request: '+url)};document.querySelector('#quote-form button[type="submit"]').click();return true})()`);
for(let attempt=0;attempt<30;attempt++){
  if(await evaluate(`document.querySelector('#request-confirmation').hidden===false`))break;
  await new Promise(resolve=>setTimeout(resolve,100));
}
const submission = await evaluate(`({received:!document.querySelector('#request-confirmation').hidden,requests:window.__mockRequests.map(item=>({url:item.url,action:item.body.action})),quote:window.__mockRequests.find(item=>item.body.action==='create')?.body.quote})`);
assert.equal(submission.received,true,'The mocked custom request completed locally.');
assert.deepEqual(submission.requests.map(item=>item.action),['create','finalize']);
assert.match(submission.quote.message,/Requested custom service: Glass Door/);
assert.match(submission.quote.message,/Referral code: jeff/);
assert.equal(submission.quote.glass_type,'Custom quote — no automatic pricing');
assert.equal(submission.quote.estimated_price,null);
assert.equal(await evaluate(`document.querySelector('.tracking-credentials').hidden`),true);
assert.match(await evaluate(`document.querySelector('#request-tracking-notice').textContent`),/tracking details were not returned/);
assert.equal(await evaluate(`document.querySelector('#tracking-form').elements.accessCode.value`),'','Missing response does not retain the previous customer access code.');

await evaluate(`document.querySelector('[data-review-request]').click();window.__partialActions=[];window.fetch=async(input,init)=>{window.__partialActions.push(JSON.parse(init.body).action);return new Response(JSON.stringify({trackingNumber:'BGM-2026-00042',accessCode:'a'.repeat(43),uploads:[],finalizeToken:null,uploadPreparationError:'Local attachment preparation failure'}),{status:201,headers:{'content-type':'application/json'}})};document.querySelector('#quote-form button[type="submit"]').click()`);
await pause();
assert.match(await evaluate(`document.querySelector('#request-processing-note').textContent`),/request was received, but photo processing did not finish/);
assert.equal(await evaluate(`document.querySelector('#request-processing-note').checkVisibility()`),true);
assert.equal(await evaluate(`document.querySelector('#request-order-number').textContent`),'BGM-2026-00042');
assert.deepEqual(await evaluate(`window.__partialActions`),['create'],'Partial receipt does not finalize failed attachments.');
assert.equal(consoleErrors.length,1,'Exactly one deliberately simulated upload error was reported.');
assert.match(consoleErrors.pop(),/Local attachment preparation failure/);

// Tracking uses only recorded facts, with no invented earlier milestones.
await evaluate(`document.querySelector('#request-confirmation a[href="#tracking"]').click()`);
assert.equal(await evaluate(`document.body.dataset.taskView`),'tracking');
await evaluate(`window.fetch=async()=>new Response(JSON.stringify({project:{orderNumber:'BGM-2026-00042',status:'Completed',finalQuote:{status:'Not published'},payment:{}}}),{status:200,headers:{'content-type':'application/json'}});const f=document.querySelector('#tracking-form');f.elements.orderNumber.value='BGM-2026-00042';f.elements.accessCode.value='a'.repeat(43);f.querySelector('button').click()`);
await pause();
assert.equal(await evaluate(`document.querySelectorAll('.tracking-stages li').length`),8);
assert.match(await evaluate(`document.querySelector('.tracking-stages').textContent`),/Fabrication progress not recorded/);
assert.match(await evaluate(`document.querySelector('.tracking-stages').textContent`),/Payment verification not recorded/);
await evaluate(`document.querySelector('[data-exit-quote]').click()`);
assert.equal(await evaluate(`document.querySelector('.sales-hero').checkVisibility()`),true,'Main website is preserved and accessible.');

// The local browser network interceptor supplies a test-only classification fixture.
await send('Page.navigate',{url:localOrigin+'/index.html?ref=jeff&test-provider=1#quote'});
await new Promise(resolve=>setTimeout(resolve,700));
await evaluate(`document.querySelector('[data-value="Shower Doors"]').click()`);
await next();
await setFields([['width','61 1/4'],['height','73']]);
await evaluate(`(()=>{const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='),c=>c.charCodeAt(0));const files=new DataTransfer();files.items.add(new File([bytes],'test-opening.png',{type:'image/png'}));document.querySelector('#photos').files=files.files;document.querySelector('#photos').dispatchEvent(new Event('change',{bubbles:true}));})()`);
await pause();
assert.match(await evaluate(`document.querySelector('.scan-result-status').textContent`),/Photo ready/);
await evaluate(`document.querySelector('[data-analyze-photo]').click()`);
await new Promise(resolve=>setTimeout(resolve,500));
assert.match(await evaluate(`document.querySelector('[data-vision-result]').textContent||document.querySelector('.scan-result-status').textContent`),/Likely project: Shower Glass/);
assert.match(await evaluate(`document.querySelector('[data-vision-result]').textContent`),/86%/);
assert.match(await evaluate(`document.querySelector('[data-vision-result]').textContent`),/does not measure dimensions/);
assert.equal(await evaluate(`document.querySelector('#width').value`),'61 1/4','Classification does not alter customer-entered measurements.');
assert.equal(await evaluate(`document.querySelector('#product').value`),'','Recommendation is not applied until customer selects it.');
await checkStepLayouts();
await evaluate(`document.querySelector('[data-vision-result] button').click()`);
assert.equal(await evaluate(`document.querySelector('#product').value`),'Sliding Door','Customer may choose to apply a recommendation.');
await setFields([['width','63 1/16'],['height','74 1/4']]);
await next();
assert.equal(await evaluate(`QuoteMeasurement.snapshot().width`),'63 1/16');
assert.equal(await evaluate(`document.querySelector('#width').readOnly || document.querySelector('#width').disabled`),false);

await send('Page.navigate',{url:localOrigin + '/admin.html'});
await new Promise(resolve=>setTimeout(resolve,1200));
const admin = await evaluate(`({login:!document.querySelector('#login-panel').hidden,crm:!document.querySelector('#crm-panel').hidden,pricingForm:!!document.querySelector('#pricing-settings-form'),saveType:document.querySelector('#save-selling-prices')?.type})`);
assert.equal(admin.login,true,'Admin login remains available.');
assert.equal(admin.pricingForm,true,'Admin pricing UI remains present.');
assert.equal(admin.saveType,'button','Admin Save remains protected from native form navigation.');
assert.deepEqual(exceptions,[],'No uncaught JavaScript exceptions.');
assert.deepEqual(consoleErrors,[],'No JavaScript console errors.');

console.log(JSON.stringify({viewportResults,responsiveStepChecks,configurator:'shower, mirror, glass, custom; validation, camera/manual, review, prices, cart, upload/create/finalize',customQuote:'mocked only; no production requests or records',admin,exceptions,consoleErrors},null,2));
socket.close();
