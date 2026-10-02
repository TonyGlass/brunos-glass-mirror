import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

const port = Number(process.env.PRESENTATION_CDP_PORT || 9444);
const localOrigin = `http://127.0.0.1:${process.env.PRESENTATION_HTTP_PORT || 8766}`;
const endpoint = `http://127.0.0.1:${port}/json/list`;
let targets=[],target;
for(let attempt=0;attempt<50;attempt++){
  targets=await(await fetch(endpoint)).json();
  target=targets.find(item=>item.type==='page'&&item.url.startsWith(localOrigin+'/index.html'));
  if(target)break;
  await new Promise(resolve=>setTimeout(resolve,100));
}
assert.ok(target, `Open the local presentation in headless Edge with remote debugging enabled first. Targets: ${JSON.stringify(targets.map(({type,url})=>({type,url})))}`);

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
  const metrics = await evaluate(`({width:innerWidth,documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,marketing:!!document.querySelector('.sales-hero,.services-editorial,.process-editorial,.scan-editorial'),quote:!!document.querySelector('#quote-form'),photos:!!document.querySelector('#photos'),qrCards:document.querySelectorAll('.qr-card').length,images:[...document.querySelectorAll('img[src^="images/"]')].filter(image=>image.complete).every(image=>image.naturalWidth>0),nav:getComputedStyle(document.querySelector('.quote-app-bar')).display,referral:document.querySelector('#quote-referral-note')?.textContent,trackLink:!!document.querySelector('.quote-app-bar a[href="#tracking"]')})`);
  assert.ok(metrics.documentWidth<=metrics.width,`No horizontal overflow at ${width}px`);
  assert.ok(!metrics.marketing && metrics.quote && metrics.photos && metrics.images,`Focused quotation app and local imagery load at ${width}px`);
  assert.equal(metrics.trackLink,true);
  assert.equal(metrics.qrCards,3);
  assert.equal(metrics.referral,'Referred by Jeff');
  viewportResults.push({width,overflow:false,nav:metrics.nav,imagesLoaded:metrics.images});
}
assert.equal(await evaluate(`document.querySelector('.wizard-progress').checkVisibility()`),false,'Wizard progress is not rendered to customers.');
assert.equal(await evaluate(`[...document.querySelectorAll('.wizard-next,.wizard-back')].some(button=>button.checkVisibility())`),false,'There is no customer-facing Next / Back wizard.');
assert.ok(await evaluate(`[...document.querySelectorAll('.wizard-step-panel')].filter(panel=>panel.checkVisibility()).length>=6`),'All applicable quote sections are visible together on the single page.');

const advanceFormValidation = async () => { await evaluate(`document.querySelector('.wizard-step-panel.is-current .wizard-next').click()`); await checkResponsiveLayouts(); };
const setFields = values => evaluate(`(()=>{for(const [id,value] of ${JSON.stringify(values)}){const node=document.getElementById(id);node.value=value;node.dispatchEvent(new Event(node.tagName==='INPUT'?'input':'change',{bubbles:true}));}})()`);
const pause = () => new Promise(resolve => setTimeout(resolve,350));
let responsiveLayoutChecks = 0;

await send('Emulation.setDeviceMetricsOverride',{width:320,height:850,deviceScaleFactor:1,mobile:true});
assert.equal(await evaluate(`document.querySelector('.quote-app-bar a[href="#tracking"]').textContent`),'Track Your Project');
const reducedMotion = await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
assert.ok(reducedMotion);
assert.equal(await evaluate(`matchMedia('(prefers-reduced-motion: reduce)').matches`),true);

await evaluate(`document.querySelector('[data-value="Shower Doors"]').click()`);
assert.equal(await evaluate(`document.querySelector('#service').value`),'Shower Doors','Shower category starts the matching service.');
assert.equal(await evaluate(`document.querySelector('#product').value`),'','Choosing Shower does not assume a physical configuration.');
assert.equal(await evaluate(`document.querySelector('#glass-type').value`),'','Configuration leaves material independent.');
assert.equal(await evaluate(`document.querySelector('#width').checkVisibility()`),true,'Measurement fields remain on the continuous page.');
await evaluate(`(()=>{const s=document.querySelector('#service');s.value='';s.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-value="Mirror"]').click();})()`);
assert.equal(await evaluate(`document.querySelector('#service').value`),'Mirror','Mirror category starts the mirror flow.');
assert.equal(await evaluate(`document.querySelector('#mirror-layout').value`),'','Choosing Mirror leaves placement optional and customer-controlled.');
await evaluate(`(()=>{const s=document.querySelector('#service');s.value='';s.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-custom-service="Commercial Interior Glazing / Glass Partitions"]').click()})()`);
assert.equal(await evaluate(`document.body.dataset.quoteMode`),'custom','Architectural glass starts a custom review request.');
assert.equal(await evaluate(`document.querySelector('#custom-quote-selection-name').textContent`),'Commercial Interior Glazing / Glass Partitions');
await setFields([['width','60'],['height','72']]);await advanceFormValidation();
assert.match(await evaluate(`document.querySelector('#estimated-price-value').textContent`),/Custom quote|estimate prepared after review/,'No automatic custom price is shown.');
assert.doesNotMatch(await evaluate(`document.querySelector('#estimated-price-value').textContent`),/\$\s?\d/,'Custom glass has no invented estimate.');
await evaluate(`document.querySelector('[data-change-quote-service]').click()`);

async function checkResponsiveLayouts() {
  for (const width of [320,375,768,1024,1440]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<=760});
    const metrics = await evaluate(`({width:innerWidth,content:document.documentElement.scrollWidth})`);
    assert.ok(metrics.content<=metrics.width,`Single-page content fits ${width}px`);
    responsiveLayoutChecks++;
  }
  await send('Emulation.setDeviceMetricsOverride',{width:375,height:900,deviceScaleFactor:1,mobile:true});
}

await evaluate(`window.__mockRequests=[];window.fetch=async(input,init={})=>{const body=JSON.parse(init.body||'{}');window.__mockRequests.push(body);const hasMirrorFrame=body.project?.service==='Mirror'&&body.project.mirrorFrame===true;const base=hasMirrorFrame?2100:1980;const estimate={complete:true,baseLow:base,baseHigh:base,low:base,high:Math.round(base*1.1*100)/100,estimateFactor:1.1,revision:3,breakdown:hasMirrorFrame?{material:1800,frame:300,enduroShield:0}:{material:1980,frame:0,enduroShield:0}};return new Response(JSON.stringify(body.action==='estimate'?{estimate}:body.action==='create'?{uploads:(body.files||[]).map((file,i)=>({path:'local/'+i,token:'local'})),finalizeToken:'local-only',trackingNumber:'BGM-LOCAL-1',accessCode:'local-test-code'}:{ok:true}),{status:200,headers:{'content-type':'application/json'}})};`);
assert.equal(await evaluate(`(async()=>{const original=window.fetch;window.fetch=async()=>new Response(JSON.stringify({estimate:{complete:true,low:1800,high:1800,revision:3}}),{status:200,headers:{'content-type':'application/json'}});try{await requestEstimatedPrice({service:'Mirror',glassType:'Clear Mirror - 1/4',width:60,height:96,quantity:1,counts:{}});return 'accepted'}catch(error){return error.message}finally{window.fetch=original}})()`),'Invalid pricing response. Please try again.','Old staging pricing payloads without baseLow/baseHigh cannot masquerade as valid estimates.');
await advanceFormValidation();
assert.match(await evaluate(`document.querySelector('.wizard-validation').textContent`),/required selection/i,'A project is required before progressing the internal form validation.');
await evaluate(`document.querySelector('[data-value="Shower Doors"]').click()`);
assert.equal(await evaluate(`document.body.classList.contains('quote-app-active')`),true);
assert.equal(await evaluate(`document.querySelector('.sales-hero,.services-editorial,.process-editorial,.scan-editorial')`),null,'Marketing sections were removed.');
assert.equal(await evaluate(`[...document.querySelectorAll('.official-logo')].filter(n=>n.checkVisibility()).length`),1,'One branded header in quotation mode.');
assert.equal(await evaluate(`document.querySelector('#photos').checkVisibility()`),true,'Photos are available alongside measurements.');
assert.equal(await evaluate(`(()=>{const input=document.querySelector('#photos');const original=input.click;let capture;input.click=()=>{capture=input.getAttribute('capture')};document.querySelector('[data-scan-camera]').click();input.click=original;document.querySelector('[data-scan-upload]').click();return capture==='environment'&&document.activeElement.id==='width'&&input.getAttribute('capture')===null})()`),true,'Camera opens photo selection; manual mode focuses editable measurements.');
await setFields([['quantity','1'],['width','60 1/3'],['height','72']]);
assert.equal(await evaluate(`document.querySelector('.wizard-step-panel.is-current').contains(document.querySelector('#width'))`),true,'The measurement section is active for the dimension validation case.');
assert.deepEqual(await evaluate(`[...document.querySelector('.wizard-step-panel.is-current').querySelectorAll('[required]')].filter(field=>!field.checkValidity()).map(field=>field.id)`),[],'All required measurement fields are complete before testing dimension syntax.');
await advanceFormValidation();
assert.match(await evaluate(`document.querySelector('.wizard-validation').textContent`),/whole inches|supported 1\/4/i,'Unsupported dimensions are rejected.');
await setFields([['width','67 5/8'],['height','95 1/16']]);
await evaluate(`(()=>{const files=new DataTransfer();files.items.add(new File(['local image'],'opening.png',{type:'image/png'}));document.querySelector('#photos').files=files.files;document.querySelector('#photos').dispatchEvent(new Event('change',{bubbles:true}));})()`);
await pause();
assert.match(await evaluate(`document.querySelector('.scan-result-status').textContent`),/Photo ready.*Select Analyze photo/);
assert.equal(await evaluate(`document.querySelector('.scan-dimensions').hidden`),true);
assert.equal(await evaluate(`document.querySelector('#width').value`),'67 5/8','Unavailable provider leaves entered fractions alone.');
await setFields([['opening-placement','tub']]);
await advanceFormValidation();
assert.match(await evaluate(`document.querySelector('.configuration-recommendation').textContent`),/Recommended for your space: Tub Enclosure/);
assert.equal(await evaluate(`document.querySelector('#product').value`),'','Recommendation does not select a layout for the customer.');
assert.equal(await evaluate(`[...document.querySelectorAll('.mirror-configuration img')].some(n=>n.checkVisibility())`),false);
assert.ok(await evaluate(`[...document.querySelectorAll('[data-choice-list-for="product"] img')].every(n=>n.src.includes('/images/reference/shower-'))`),'Only shower reference photos appear in shower configuration.');
assert.equal(await evaluate(`document.querySelectorAll('[data-choice-list-for="product"] button').length`),6);
await advanceFormValidation();
assert.match(await evaluate(`document.querySelector('.wizard-validation').textContent`),/required selection/i,'A shower configuration is required before pricing.');
await evaluate(`document.querySelector('[data-choice-list-for="product"] button').click()`);
assert.equal(await evaluate(`document.querySelector('#door-type').value`),'Sliding Door');
await advanceFormValidation();
await setFields([['glass-type','Low-Iron Glass - 3/8'],['hardware-finish','Brushed Nickel']]);
assert.equal(await evaluate(`[...document.querySelectorAll('.hardware-count-grid input')].every(input=>!input.disabled&&!input.readOnly)`),true,'Hardware quantities are customer-editable whole-number inputs.');
await setFields([['hinge-count','2'],['handle-count','1']]);
await advanceFormValidation(); await pause();
assert.equal(await evaluate(`document.querySelectorAll('.estimated-price-panel').length`),1,'The quote has one full Live Estimate card.');
assert.equal(await evaluate(`[...document.querySelectorAll('[data-deposit-contact]')].filter(link=>link.checkVisibility()).length`),1,'Exactly one deposit-contact CTA is visible with the Live Estimate.');
assert.equal(await evaluate(`[...document.querySelectorAll('.hardware-count-grid input')].every(input=>input.checkValidity())`),true,'Entered hardware quantities satisfy nonnegative whole-number constraints.');
assert.deepEqual(await evaluate(`window.__mockRequests.filter(request=>request.action==='estimate').at(-1).project.counts`),{splitLites:0,hinges:2,handles:1,clips:0,sweeps:0,channels:0,accessories:0},'Manual hardware quantities reach the central-pricing request.');
assert.equal(await evaluate(`document.querySelector('#estimated-price-value').textContent`),'$1,980.00 – $2,178.00','Live estimate uses the $1,980 base plus 10%.');
assert.equal(await evaluate(`document.querySelector('[data-estimate-base]').textContent`),'Base estimate: $1,980.00','Live base estimate is $1,980.00.');
assert.equal(await evaluate(`document.querySelector('[data-estimate-deposit]').textContent`),'$990.00','Live 50% deposit is calculated from the $1,980 base.');
await evaluate(`renderEstimateDisplays({complete:true,baseLow:1980,baseHigh:1980,low:1980,high:2178,estimateFactor:1.1,revision:3})`);
assert.equal(await evaluate(`document.querySelector('#estimated-price-value').textContent`),'$1,980.00 – $2,178.00','Rendered one-page estimate shows the approved $1,980 base plus 10%.');
assert.equal(await evaluate(`document.querySelector('[data-estimate-deposit]').textContent`),'$990.00','Rendered estimated deposit is 50% of base, not range high.');
assert.deepEqual(await evaluate(`Object.fromEntries([...document.querySelectorAll('[data-review-estimate]')].map(node=>[node.dataset.reviewEstimate,node.textContent]))`),{range:'$1,980.00 – $2,178.00',base:'Base estimate: $1,980.00',deposit:'$990.00'},'Review estimate summary stays synchronized with the sole Live Estimate card.');
assert.equal(await evaluate(`document.querySelector('[data-deposit-contact] [data-deposit-cta-amount]').textContent`),'$990','Deposit CTA amount is large, live and based on 50% of base.');
await evaluate(`document.querySelector('[data-deposit-contact]').click()`);
assert.match(await evaluate(`document.querySelector('[data-deposit-followup]').textContent`),/Submit your quote request first.*Order Number after submission/i);
assert.doesNotMatch(await evaluate(`document.querySelector('[data-deposit-contact]').href`),/^mailto:/,'The contact action cannot invent an Order Number before quote submission.');
assert.equal(await evaluate(`[...document.querySelectorAll('#quote-form input')].some(input=>/card|payment|cc-number/i.test(input.name+' '+input.id))`),false,'Deposit information CTA does not collect payment details.');
await evaluate(`document.querySelector('#quote').scrollIntoView()`);
await writeFile(new URL('../.wrangler/configurator-mobile.png',import.meta.url),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
await advanceFormValidation();
await setFields([['name','<b>Demo Customer</b>'],['phone','9545550100'],['email','invalid'],['city','Hollywood']]);
await advanceFormValidation();
assert.equal(await evaluate(`document.querySelector('#email').checkValidity()`),false,'Invalid customer email is rejected.');
await setFields([['email','demo@example.com']]);
await advanceFormValidation();
assert.equal(await evaluate(`!!document.querySelector('.quote-review-summary b')`),false,'Customer text is never interpreted as markup.');
assert.match(await evaluate(`document.querySelector('.quote-review-summary').textContent`),/67 5\/8 × 95 1\/16 in/);
assert.match(await evaluate(`document.querySelector('.quote-review-summary').textContent`),/opening.png/);
assert.equal(await evaluate(`document.querySelectorAll('[id]').length===new Set([...document.querySelectorAll('[id]')].map(n=>n.id)).size`),true,'No duplicate IDs after rearranging the form.');
await evaluate(`document.querySelector('[data-cart-add]').click()`);
assert.equal(await evaluate(`ProjectCartPreview.getItems()[0].estimateLabel`),'$1,980.00 – $2,178.00','The cart retains the approved estimate range.');
await setFields([['project','Local browser test only.']]);
await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
await evaluate(`window.__clipboardWrites=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.__clipboardWrites.push(text)}})`);
await evaluate(`document.querySelector('#quote-form button[type="submit"]').click()`); await pause();
const shower = await evaluate(`({quote:window.__mockRequests.find(r=>r.action==='create').quote,pricing:window.__mockRequests.find(r=>r.action==='create').pricing,uploads:window.__uploads,confirmed:!document.querySelector('#request-confirmation').hidden})`);
assert.equal(shower.confirmed,true);
assert.deepEqual(shower.pricing.counts,{splitLites:0,hinges:2,handles:1,clips:0,sweeps:0,channels:0,accessories:0},'Customer-entered hardware counts are preserved in quote submission.');
assert.equal(await evaluate(`document.querySelector('#request-order-number').textContent`),'BGM-LOCAL-1','Order number is exactly the backend fixture response.');
assert.equal(await evaluate(`document.querySelector('#request-tracking-access-code').textContent`),'local-test-code','Access code is exactly the backend fixture response.');
assert.equal(await evaluate(`document.querySelector('#tracking-credentials-card').checkVisibility()`),true,'The backend credentials card is visible after successful submission.');
assert.equal(await evaluate(`document.querySelector('.confirmation-deposit-cta').checkVisibility()`),true,'The submitted quote offers deposit follow-up from its success view.');
assert.equal(await evaluate(`[...document.querySelectorAll('[data-deposit-contact]')].filter(link=>link.checkVisibility()).length`),1,'The submitted success view still exposes only one deposit-contact CTA.');
const depositMail=await evaluate(`decodeURIComponent(document.querySelector('.confirmation-deposit-cta').href)`);
assert.match(depositMail,/^mailto:office@brunosglass\.com\?subject=Bruno’s Instant Quote — Deposit Follow-up — BGM-LOCAL-1&body=/);
assert.match(depositMail,/Customer name: <b>Demo Customer<\/b>/);
assert.match(depositMail,/Order Number: BGM-LOCAL-1/);
assert.match(depositMail,/Project type: Shower Doors/);
assert.match(depositMail,/Estimated range: \$1,980\.00 \u2013 \$2,178\.00/);
assert.match(depositMail,/Estimated 50% deposit: \$990/);
assert.doesNotMatch(depositMail,/local-test-code|PRIVATE ACCESS CODE|sb_publishable_|OPENAI_API_KEY/i,'Email content contains no private code or API secrets.');
assert.match(await evaluate(`document.querySelector('#request-confirmation').textContent`),/QUOTE REQUEST RECEIVED[\s\S]*SAVE YOUR PROJECT ACCESS[\s\S]*ORDER NUMBER[\s\S]*PRIVATE ACCESS CODE[\s\S]*SAVE OR SCREENSHOT THESE DETAILS/);
assert.equal(await evaluate(`document.querySelector('.credential-copy-status').textContent`),'');
const successMotion = await evaluate(`({card:getComputedStyle(document.querySelector('#tracking-credentials-card')).animationName,order:getComputedStyle(document.querySelector('#request-order-number')).animationName,code:getComputedStyle(document.querySelector('#request-tracking-access-code')).animationName,track:getComputedStyle(document.querySelector('.credential-track')).animationName,cardInView:(()=>{const r=document.querySelector('#tracking-credentials-card').getBoundingClientRect();return r.top<innerHeight&&r.bottom>0})(),mobileOverflow:document.documentElement.scrollWidth>innerWidth,buttonHeights:[...document.querySelectorAll('.credential-actions button,.credential-actions a,.credential-copy')].map(node=>node.getBoundingClientRect().height)})`);
assert.match(successMotion.card,/credential-card-enter/);assert.match(successMotion.order,/credential-value-emphasis/);assert.match(successMotion.code,/credential-value-emphasis/);assert.match(successMotion.track,/credential-track-attention/);
assert.equal(successMotion.cardInView,true,'The credentials card is brought into view.');assert.equal(successMotion.mobileOverflow,false,'The credentials card fits mobile width.');assert.ok(successMotion.buttonHeights.every(height=>height>=48),'Copy and track controls are touch-sized.');
await evaluate(`document.querySelector('[data-copy-credential="order"]').click()`);await pause();
assert.equal(await evaluate(`window.__clipboardWrites.at(-1)`),'BGM-LOCAL-1','Copy Order copies only the backend Order Number.');
assert.equal(await evaluate(`document.querySelector('[data-copy-credential="order"]').textContent`),'COPIED ✓');
await evaluate(`document.querySelector('[data-copy-credential="code"]').click()`);await pause();
assert.equal(await evaluate(`window.__clipboardWrites.at(-1)`),'local-test-code','Copy Code copies only the backend Private Access Code.');
assert.equal(await evaluate(`document.querySelector('[data-copy-credential="code"]').textContent`),'COPIED ✓');
await evaluate(`document.querySelector('[data-copy-both]').click()`);await pause();
assert.equal(await evaluate(`window.__clipboardWrites.at(-1)`),"Bruno's Glass & Mirror\nOrder Number: BGM-LOCAL-1\nPrivate Access Code: local-test-code",'Copy Both uses a clear customer-friendly format.');
assert.equal(await evaluate(`document.querySelector('[data-copy-both]').textContent`),'COPIED ✓');
assert.equal(await evaluate(`[...document.querySelectorAll('a')].every(link=>!link.href.includes('local-test-code'))`),true,'The private code is never placed in a URL.');
assert.equal(await evaluate(`document.querySelector('.credential-track').getAttribute('href')`),'#tracking');
assert.equal(await evaluate(`document.querySelector('#tracking-form').elements.orderNumber.value`),'BGM-LOCAL-1');
assert.equal(await evaluate(`document.querySelector('#tracking-form').elements.accessCode.value`),'local-test-code');
const trackingHash = await evaluate(`(async()=>{document.querySelector('.credential-track').click();for(let i=0;i<50&&window.location.hash!=='#tracking';i++)await new Promise(resolve=>setTimeout(resolve,20));return window.location.hash})()`);
assert.equal(trackingHash,'#tracking','Track My Project targets the real tracking section.');
assert.equal(await evaluate(`document.body.dataset.taskView`),'tracking','Track My Project opens tracking from the submitted success card.');
assert.equal(await evaluate(`document.querySelector('#tracking-form').elements.orderNumber.value`),'BGM-LOCAL-1','Tracking receives the backend-issued Order Number.');
assert.equal(await evaluate(`document.querySelector('#tracking-form').elements.accessCode.value`),'local-test-code','Tracking receives the backend-issued Private Access Code.');
assert.equal(await evaluate(`document.querySelector('[data-task-link]').textContent`),'Return to quotation','Tracking provides a visible return-to-quote control.');
assert.equal(await evaluate(`document.querySelector('[data-task-link]').getAttribute('href')`),'#quote','The visible return control targets the quote route.');
const quoteHash = await evaluate(`(async()=>{document.querySelector('[data-task-link]').click();for(let i=0;i<50&&window.location.hash!=='#quote';i++)await new Promise(resolve=>setTimeout(resolve,20));return window.location.hash})()`);
assert.equal(quoteHash,'#quote','The real return control navigates to the quote route.');
assert.equal(await evaluate(`document.body.dataset.taskView`),'quote','The customer can return to the quote after opening tracking.');
assert.equal(await evaluate(`document.querySelector('#tracking-form').elements.orderNumber.value`),'BGM-LOCAL-1','Returning to the quote does not erase the displayed tracking Order Number.');
assert.equal(await evaluate(`document.querySelector('#tracking-form').elements.accessCode.value`),'local-test-code','Returning to the quote does not erase the displayed tracking Private Access Code.');
await evaluate(`document.querySelector('#request-confirmation [data-review-request]').click()`);
assert.equal(await evaluate(`document.querySelector('#quote-form').hidden`),false,'Review Your Request reopens the quote form on the same page.');
assert.equal(await evaluate(`document.querySelector('#request-confirmation').hidden`),true,'The quote form replaces the submission success view.');
await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
const reducedCredentialMotion=await evaluate(`({card:getComputedStyle(document.querySelector('#tracking-credentials-card')).animationName,order:getComputedStyle(document.querySelector('#request-order-number')).animationName,track:getComputedStyle(document.querySelector('.credential-track')).animationName,reduce:matchMedia('(prefers-reduced-motion: reduce)').matches})`);
assert.equal(reducedCredentialMotion.reduce,true);assert.equal(reducedCredentialMotion.card,'none');assert.equal(reducedCredentialMotion.order,'none');assert.equal(reducedCredentialMotion.track,'none','Reduced motion disables all success-card animation.');
await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
assert.equal(shower.quote.width,67.625);
assert.equal(shower.quote.height,95.0625);
assert.equal(shower.quote.final_price,null);
assert.equal(shower.quote.estimated_price,1980,'The saved estimate is the $1,980 base price.');
assert.equal(shower.quote.estimated_price_low,1980,'The range starts at the $1,980 base.');
assert.equal(shower.quote.estimated_price_high,2178,'The high estimate adds 10% to the $1,980 base.');
assert.equal(shower.uploads[0].name,'opening.png');
assert.equal(await evaluate(`document.querySelector('.scan-photo-status').textContent`),'','Uploaded attachments no longer appear selected.');

// Continue with the other project categories on the same quote page.
await evaluate(`document.querySelector('[data-value="Mirror"]').click()`);
await advanceFormValidation(); await advanceFormValidation();
assert.equal(await evaluate(`[...document.querySelectorAll('[data-choice-list-for="product"] img')].some(n=>n.checkVisibility())`),false,'Mirror never shows shower cards.');
await setFields([['mirror-layout','Wall Mirror']]);
await advanceFormValidation();
assert.equal(await evaluate(`document.querySelector('#mirror-frame').checkVisibility()`),true,'Mirror frame belongs in Options.');
await setFields([['glass-type','Clear Mirror - 1/4'],['mirror-frame','yes']]);
await advanceFormValidation(); await pause();
const breakdowns = await evaluate(`[...document.querySelectorAll('[data-estimate-breakdown]')].map(n=>({hidden:n.hidden,text:n.textContent}))`);
assert.equal(breakdowns.length,1,'Only the Live Estimate card contains a material breakdown.');
assert.ok(!breakdowns[0].hidden && breakdowns[0].text.includes('Metal / Frame: $300.00'),'The Live Estimate shows the selected Mirror frame breakdown.');
const mirrorPricing = await evaluate(`({ranges:[...document.querySelectorAll('[data-estimate-price]')].map(n=>n.textContent),bases:[...document.querySelectorAll('[data-estimate-base]')].map(n=>n.textContent),deposits:[...document.querySelectorAll('[data-estimate-deposit]')].map(n=>n.textContent)})`);
assert.deepEqual(mirrorPricing,{ranges:['$2,100.00 \u2013 $2,310.00'],bases:['Base estimate: $2,100.00'],deposits:['$1,050.00']},'Mirror pricing has one base, 10% range and 50% deposit source.');
assert.deepEqual(await evaluate(`Object.fromEntries([...document.querySelectorAll('[data-review-estimate]')].map(node=>[node.dataset.reviewEstimate,node.textContent]))`),{range:'$2,100.00 \u2013 $2,310.00',base:'Base estimate: $2,100.00',deposit:'$1,050.00'},'Mirror Review summary matches its sole Live Estimate card.');
await advanceFormValidation(); await advanceFormValidation();
assert.match(await evaluate(`document.querySelector('.quote-review-summary').textContent`),/Wall Mirror/);
await evaluate(`window.__mockRequests=[];document.querySelector('#quote-form button[type="submit"]').click()`); await pause();
assert.match(await evaluate(`window.__mockRequests.find(r=>r.action==='create').quote.message`),/Mirror placement: Wall Mirror/);
const mirrorSavedQuote=await evaluate(`window.__mockRequests.find(r=>r.action==='create').quote`);
assert.deepEqual([mirrorSavedQuote.estimated_price,mirrorSavedQuote.estimated_price_low,mirrorSavedQuote.estimated_price_high],[2100,2100,2310],'The submitted Mirror quote preserves the same base and range as Live Estimate and Review.');
await evaluate(`document.querySelector('[data-value="Glass"]').click()`);
await advanceFormValidation(); await advanceFormValidation();
assert.equal(await evaluate(`document.querySelector('#mirror-frame').value`),'no');
await advanceFormValidation();
assert.equal(await evaluate(`document.querySelector('#mirror-frame-group').hidden`),true);
assert.equal(await evaluate(`document.querySelector('#glass-type').value`),'');

// Custom cards inside the configurator also work after removing the old modal.
await evaluate(`document.querySelector('.service-options [data-custom-service]').click()`);
assert.equal(await evaluate(`document.body.dataset.quoteMode`),'custom');
await evaluate(`document.querySelector('[data-change-quote-service]').click()`);
assert.equal(await evaluate(`document.querySelector('#service').value`),'');

await evaluate(`(()=>{document.querySelector('[data-category-info="glass-doors"]').click();return true})()`);
assert.deepEqual(await evaluate(`({mode:document.body.dataset.quoteMode,service:document.querySelector('#custom-quote-selection-name').textContent,price:document.querySelector('#estimated-price-value').textContent,materialHidden:document.querySelector('#glass-type-group').hidden,upload:!!document.querySelector('#photos')})`),{
  mode:'custom',service:'Glass Door',
  price:'Custom quote — estimate prepared after review.',materialHidden:true,upload:true
});
await setFields([['width','60'],['height','72'],['name','Demo Customer'],['phone','9545550100'],['email','demo@example.com'],['city','Hollywood'],['project','Local browser test only.']]);
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
await evaluate(`document.querySelector('.quote-app-bar a[href="#quote"]').click()`);
assert.equal(await evaluate(`document.querySelector('.sales-hero,.services-editorial,.process-editorial,.scan-editorial')`),null,'Marketing presentation remains removed in all app routes.');

// This uses a synthetic test fixture, not a real customer photo or measurement.
await send('Page.navigate',{url:localOrigin+'/index.html?ref=jeff&test-provider=1#quote'});
await new Promise(resolve=>setTimeout(resolve,700));
await evaluate(`document.querySelector('[data-value="Shower Doors"]').click()`);
await advanceFormValidation();
await setFields([['width','61 1/4'],['height','73']]);
await evaluate(`(()=>{const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='),c=>c.charCodeAt(0));const files=new DataTransfer();files.items.add(new File([bytes],'test-opening.png',{type:'image/png'}));document.querySelector('#photos').files=files.files;document.querySelector('#photos').dispatchEvent(new Event('change',{bubbles:true}));})()`);
await pause();
assert.match(await evaluate(`document.querySelector('.scan-result-status').textContent`),/Photo ready/);
await evaluate(`document.querySelector('[data-analyze-photo]').click()`);
await new Promise(resolve=>setTimeout(resolve,500));
assert.match(await evaluate(`document.querySelector('[data-vision-result]').textContent||document.querySelector('.scan-result-status').textContent`),/Likely project: Shower Glass/);
assert.match(await evaluate(`document.querySelector('[data-vision-result]').textContent`),/86%/);
assert.match(await evaluate(`document.querySelector('[data-vision-result]').textContent`),/Opening geometry: Straight bathtub \/ alcove/);
assert.match(await evaluate(`document.querySelector('[data-vision-result]').textContent`),/Best match: Tub Enclosure[\s\S]*Alternative: Sliding Door/,'Straight-tub recommendations follow the compatible catalog priority.');
assert.doesNotMatch(await evaluate(`document.querySelector('[data-vision-result]').textContent`),/90° Corner|Neo-Angle|Fixed Panel \/ Walk-In|Swing Door \+ Fixed Panel/,'The straight-tub result excludes incompatible layouts.');
assert.equal(await evaluate(`document.querySelector('[data-vision-result] img').getAttribute('src')`),'images/reference/shower-tub.jpg','A straight-tub recommendation uses its matching tub reference.');
assert.equal(await evaluate(`document.querySelector('#width').value`),'60','A responsible AI estimate populates width.');
assert.equal(await evaluate(`document.querySelector('#height').value`),'72','A responsible AI estimate populates height.');
assert.equal(await evaluate(`document.querySelector('[data-confirm-ai-measurement]').checked`),false,'AI estimates require explicit confirmation.');
await setFields([['width','61 1/4']]);
await evaluate(`document.querySelector('[data-confirm-ai-measurement]').click()`);
assert.equal(await evaluate(`document.querySelector('[data-confirm-ai-measurement]').checked`),true,'Customer confirms the corrected AI estimate.');
assert.deepEqual(await evaluate(`QuoteMeasurement.getMeasurementRecord(61.25,72)`),{aiEstimatedWidth:60,aiEstimatedHeight:72,customerConfirmedWidth:61.25,customerConfirmedHeight:72,measurementConfidence:.84,measurementSource:'ai_estimated_edited',explicitlyConfirmed:true},'Edited AI estimates retain their source/confidence separately from confirmed dimensions.');
assert.equal(await evaluate(`document.querySelector('#product').value`),'','Recommendation is not applied until customer selects it.');
await checkResponsiveLayouts();
await evaluate(`document.querySelector('[data-vision-result] button').click()`);
assert.equal(await evaluate(`document.querySelector('#product').value`),'Tub Enclosure','Customer may choose the best matching catalog recommendation.');
await setFields([['glass-type','Low-Iron Glass - 3/8'],['hardware-finish','Brushed Nickel'],['handle-style','Ladder Handle']]);
const aiEstimateRequest=await evaluate(`(async()=>{const original=window.fetch;window.__confirmedPhotoEstimateRequests=[];window.fetch=async(input,init={})=>{const body=JSON.parse(init.body||'{}');window.__confirmedPhotoEstimateRequests.push(body);return new Response(JSON.stringify({estimate:{complete:true,baseLow:1800,baseHigh:1800,low:1800,high:1980,estimateFactor:1.1,revision:3}}),{status:200,headers:{'content-type':'application/json'}})};try{const estimate=await requestEstimatedPrice(currentPricingProject());return{estimate,request:window.__confirmedPhotoEstimateRequests[0],confirmed:QuoteMeasurement.isConfirmed()}}finally{window.fetch=original}})()`);
assert.equal(aiEstimateRequest.confirmed,true,'The edited AI dimensions are confirmed before the estimate request.');
assert.deepEqual([aiEstimateRequest.request.project.width,aiEstimateRequest.request.project.height],[61.25,72],'The corrected customer dimensions reach the pricing request.');
assert.deepEqual([aiEstimateRequest.estimate.low,aiEstimateRequest.estimate.high],[1800,1980],'Photo measurement does not alter the pricing contract.');
await setFields([['width','63 1/16'],['height','74 1/4']]);
await advanceFormValidation();
assert.equal(await evaluate(`QuoteMeasurement.snapshot().width`),'63 1/16');
assert.equal(await evaluate(`document.querySelector('#width').readOnly || document.querySelector('#width').disabled`),false);

assert.equal(await evaluate(`document.querySelector('#tracking-credentials-card').checkVisibility()`),false,'A fresh page does not display credentials from an earlier quote submission.');
await send('Page.navigate',{url:localOrigin + '/admin.html'});
await new Promise(resolve=>setTimeout(resolve,1200));
const admin = await evaluate(`({login:!document.querySelector('#login-panel').hidden,crm:!document.querySelector('#crm-panel').hidden,pricingForm:!!document.querySelector('#pricing-settings-form'),saveType:document.querySelector('#save-selling-prices')?.type})`);
assert.equal(admin.login,true,'Admin login remains available.');
assert.equal(admin.pricingForm,true,'Admin pricing UI remains present.');
assert.equal(admin.saveType,'button','Admin Save remains protected from native form navigation.');
assert.deepEqual(exceptions,[],'No uncaught JavaScript exceptions.');
assert.deepEqual(consoleErrors,[],'No JavaScript console errors.');

console.log(JSON.stringify({viewportResults,responsiveLayoutChecks,configurator:'shower, mirror, glass, custom; validation, camera/manual, review, prices, cart, upload/create/finalize',customQuote:'mocked only; no production requests or records',admin,exceptions,consoleErrors},null,2));
socket.close();
