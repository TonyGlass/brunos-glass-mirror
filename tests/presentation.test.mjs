import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('../script.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const experienceCss = readFileSync(new URL('../quote-experience.css', import.meta.url), 'utf8');
const measurement = readFileSync(new URL('../measurement.js', import.meta.url), 'utf8');
const admin = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const adminScript = readFileSync(new URL('../admin.js', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../project-workflow.js', import.meta.url), 'utf8');
const root = new URL('../', import.meta.url);
const dist = new URL('../dist/', import.meta.url);
const decode = value => value.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#8217;', '’');

test('root is a focused quotation application without deleted marketing sections', () => {
  assert.match(html, /<main id="main-content"><section class="quote section-pad" id="quote">/);
  assert.match(html, /id="wizard-step-count">STEP 1 OF 7/);
  assert.match(html, /id="wizard-step-name">Project Type/);
  assert.match(html, /class="wizard-progress"[^>]*hidden/);
  for (const stale of ['Glass, with a', 'From first conversation', 'THE CUSTOMER JOURNEY', 'Scan your space.', 'COMING SOON']) assert.ok(!html.includes(stale), `Removed marketing presentation: ${stale}`);
  for (const path of ['images/reference/shower-sliding.jpg','images/reference/mirror-custom.jpg','images/reference/glass-partitions.jpg']) assert.ok(existsSync(new URL(path, root)), `Required configurator image remains: ${path}`);
  assert.doesNotMatch(script.slice(script.indexOf('const products = ['), script.indexOf('// PRODUCT GALLERY')), /https?:\/\//,
    'Priced product previews should use supplied Bruno photographs rather than remote stock images.');
});

test('instant quote uses one progressive page with approved catalog and custom-option fields', () => {
  assert.match(html,/<h1>Bruno.*Instant Quote&#8482;<\/h1>/);
  assert.match(html,/Powered by Bruno&#8217;s Glass<\/p>/);
  assert.match(html,/Your Glass\. Your Style\. Your Estimate\./);
  assert.match(experienceCss,/wizard-progress \{ display:none !important/);
  assert.match(experienceCss,/\.wizard-next,\s*\.wizard-back \{ display:none !important/);
  assert.match(experienceCss,/\.quote-app-active \.wizard-step-panel:not\(\[hidden\]\) \{ display:block/);
  assert.doesNotMatch(`${html}\n${script}\n${css}\n${experienceCss}`, /\$150 allowance/i);
  assert.match(script,/const isVisible = sectionPosition > 0/);
  assert.match(script,/actions\.hidden=true/);
  assert.doesNotMatch(script,/Continue to \$\{labels\[sectionPosition\]\} below/);
  assert.match(html,/CONTINUE WITH 50% DEPOSIT/);
  assert.match(html,/data-deposit-contact/);
  assert.match(html,/office@brunosglass\.com/);
  assert.match(html,/No online or card payment is processed/);
  assert.match(script,/mailto:office@brunosglass\.com/);
  assert.match(script,/Bruno\\u2019s Instant Quote \\u2014 Deposit Follow-up/);
  assert.match(script,/Order Number: \$\{order\}/);
  assert.match(script,/Customer name: \$\{name\}/);
  assert.match(script,/Estimated 50% deposit: \$\{depositText\}/);
  assert.match(script,/No payment has been made through the website/);
  assert.doesNotMatch(html,/<input[^>]*(card|payment|cc-number)/i);
  assert.match(html,/id="glass-other-description"/);
  assert.match(html,/id="hardware-other-finish"/);
  assert.match(script,/\['Other','Other.*Bruno to review'\]/);
  assert.doesNotMatch(script,/Clear Glass - 1\/2|Low-Iron Glass - 1\/2/);
  assert.match(script,/Requested glass: \$\{glassOtherDescription\.value\.trim\(\)\}/);
  assert.match(script,/Requested hardware finish: \$\{hardwareOtherFinish\.value\.trim\(\)\}/);
  assert.match(script,/hardwareOtherFinish\.required = otherHardware/);
  assert.match(script,/glassOtherDescription\.required = otherGlass/);
  assert.match(measurement,/scan-measure-guide/);
  assert.match(measurement,/AI ESTIMATED — PLEASE CONFIRM/);
  assert.match(measurement,/data-confirm-ai-measurement/);
  assert.match(script,/!window\.QuoteMeasurement\.isConfirmed\(\)/);
  assert.match(measurement,/WIDTH/);
  assert.match(measurement,/HEIGHT/);
});

test('hardware count inputs remain enabled, whole-number customer inputs',()=>{
  const ids=['hinge-count','split-lite-count','handle-count','clip-count','sweep-count','channel-count','accessory-count'];
  for(const id of ids){
    const input=html.match(new RegExp(`<input id="${id}"[^>]*>`))?.[0];
    assert.ok(input,`${id} remains present`);
    assert.match(input,/type="number"/);
    assert.match(input,/min="0"/);
    assert.match(input,/step="1"/);
    assert.doesNotMatch(input,/\b(?:disabled|readonly)\b/i,`${id} accepts manual quantities`);
  }
  assert.match(html,/whole-number quantity for each selected item/);
  assert.match(script,/field\.addEventListener\('input', updateEstimatedPrice\)/);
  assert.match(script,/hinges: Math\.max\(0, Number\(document\.querySelector\('#hinge-count'\)\?\.value \|\| 0\)\)/);
});

test('Review uses a compact synchronized estimate summary instead of cloning the Live Estimate card',()=>{
  assert.equal((html.match(/class="estimated-price-panel"/g)||[]).length,1,'Source markup contains one complete Live Estimate card.');
  assert.match(html,/id="estimated-price-panel"/);
  assert.doesNotMatch(script,/estimatePanel\.cloneNode/);
  assert.doesNotMatch(script,/details-estimated-price-panel/);
  assert.match(script,/function syncReviewEstimate\(\)/);
  assert.match(script,/detail\.dataset\.reviewEstimate = key/);
  assert.match(script,/syncReviewEstimate\(\);/);
});

test('quotation wizard retains Shower, Mirror and Architectural project references', () => {
  assert.equal((html.match(/class="official-logo"/g) || []).length, 1);
  assert.equal((html.match(/data-select="service"/g) || []).length, 3, 'Shower, Mirror, and Architectural Glass project types remain.');
  assert.match(html, /data-value="Shower Doors"[\s\S]*?images\/inspiration\/tmpef8fn6l5\.webp/);
  assert.match(html, /data-value="Mirror"[\s\S]*?images\/inspiration\/tmpt1njs01e\.webp/);
  assert.match(html, /data-category-info="commercial-glass"[\s\S]*?images\/reference\/glass-partitions\.jpg/);
  assert.match(script, /Commercial Interior Glazing \/ Glass Partitions': \{src:'images\/reference\/glass-partitions\.jpg'/);
  assert.match(script, /'Glass Door': \{src:'images\/reference\/glass-doors\.jpg'/);
});
test('custom services and unpriced glass requests remain review-only', () => {
  assert.match(html, /id="custom-quote-selection"/);
  assert.match(html, /id="photos"[\s\S]*?type="file"/);
  assert.match(script, /const customLabels = \[\'Project Type\', \'Measurements\', \'Your Information\', \'Review Request\'\]/);
  assert.match(script, /const customPanelIndexes = \[0,1,5,6\]/);
  assert.match(script, /const customQuote = Boolean\(customQuoteService \|\| customGlassRequest\)/);
  assert.match(script, /glass_type: customQuote \? \'Custom quote/);
  assert.match(script, /Requested custom service: \$\{customQuoteService\}/);
  assert.match(script, /Requested glass: \$\{glassOtherDescription\.value\.trim\(\)\}/);
  assert.match(readFileSync(new URL('../measurement.js', import.meta.url), 'utf8'), /professional field measurement is required before fabrication/);
});

test('Glass Door is a custom quote with a magazine door reference, and selections update contextual imagery', () => {
  assert.match(html, /data-category-info="glass-doors" data-custom-service="Glass Door"/);
  assert.match(html, /src="images\/magazine\/glass-door-reference\.jpg"[^>]+alt="Glass doors enclosing a wine room, shown in Bruno's company magazine"/);
  assert.match(script, /'Glass Door': \{src:'images\/reference\/glass-doors\.jpg'/);
  assert.match(script, /'Glass Railings & Balcony Systems': \{src:'images\/reference\/glass-railings\.jpg'/);
  assert.match(script, /projectReferenceImage\.src = reference\.src/);
  assert.match(script, /This photograph is not a material sample/);
  assert.match(script, /reference\.src\.includes\('\/magazine\/'\)/);
  assert.match(script, /Magazine reference only/);
  assert.match(script, /customQuoteService \|\| !glassTypeSelect\?\.value \? '' : glassTypeSelect\.selectedOptions/);
  assert.ok(existsSync(new URL('../images/magazine/glass-stair-railing-reference.jpg', import.meta.url)));
  assert.ok(existsSync(new URL('../images/magazine/glass-door-reference.jpg', import.meta.url)));
  for (const path of [
    'images/work-04.jpeg',
    'images/inspiration/tmp1x18qlnt.webp',
    'images/inspiration/WhatsApp Image 2026-09-11 at 5.43.05 PM.jpeg',
    'images/inspiration/tmpalrn5bjl.webp',
    'images/inspiration/WhatsApp Image 2026-09-11 at 5.43.08 PM (1).jpeg',
    'images/inspiration/tmpa6tg0twq.webp'
  ]) assert.ok(existsSync(new URL(`../${path}`, import.meta.url)), `Missing project reference: ${path}`);
  assert.match(script, /const referralCode = Object\.hasOwn\(referralNameByCode, referralCandidate\)/);
});

test('customer estimate adds 10 percent to the configured base and uses the estimate for deposit', () => {
  const source = script.match(/function renderEstimateDisplays\(estimate, pendingMessage = ''\) \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(source, 'The live estimate presentation function is present.');
  const nodes = new Map();
  for (const selector of ['[data-estimate-price]', '[data-estimate-base]', '[data-estimate-deposit]', '[data-estimate-breakdown]', '[data-deposit-cta-amount]']) {
    nodes.set(selector, [{textContent:'',hidden:true,classList:{toggle(){}},animate(){}}, ...(selector === '[data-estimate-price]' ? [{textContent:'',classList:{toggle(){}},animate(){}}] : [])]);
  }
  const document = {querySelectorAll:selector => nodes.get(selector),querySelector:selector => nodes.get(selector)?.[0]};
  const window = {matchMedia:() => ({matches:true})};
  const render = new Function('estimate','pendingMessage','customQuoteService','document','window','serviceSelect','isManualReviewQuote','isUnpricedGlass','currentEstimatedDeposit','updateDepositContactLinks','syncReviewEstimate',`"use strict";${source}`);
  render({complete:true,baseLow:1800,baseHigh:1800,low:1800,high:1980,estimateFactor:1.1,breakdown:{material:1800,frame:0,enduroShield:0}},'', '',document,window,{value:'Glass'},()=>false,()=>false,null,()=>{},()=>{});
  assert.deepEqual(nodes.get('[data-estimate-price]').map(node=>node.textContent),['$1,800.00 – $1,980.00','$1,800.00 – $1,980.00']);
  assert.equal(nodes.get('[data-estimate-base]')[0].textContent,'Base estimate: $1,800.00');
  assert.equal(nodes.get('[data-estimate-deposit]')[0].textContent,'$900.00');
  assert.equal(nodes.get('[data-deposit-cta-amount]')[0].textContent,'$900');
  render({complete:true,baseLow:2400,baseHigh:2400,low:2400,high:2640,estimateFactor:1.1,breakdown:{material:1800,frame:600,enduroShield:0}},'', '',document,window,{value:'Mirror'},()=>false,()=>false,null,()=>{},()=>{});
  assert.equal(nodes.get('[data-estimate-price]')[0].textContent,'$2,400.00 – $2,640.00');
  assert.equal(nodes.get('[data-estimate-deposit]')[0].textContent,'$1,200.00');
  assert.equal(nodes.get('[data-estimate-breakdown]')[0].textContent,'Mirror: $1,800.00 \u00b7 Metal / Frame: $600.00');
  assert.match(script,/estimated_price:\s*completeEstimate\s*\?\s*completeEstimate\.low/);
  assert.match(script,/estimated_price_high:\s*completeEstimate\s*\?\s*completeEstimate\.high/);
  assert.doesNotMatch(script,/estimate\.high\s*\+\s*150/);
});

test('deposit follow-up email uses the backend Order Number and safe quote details only', () => {
  const start=script.indexOf('function updateDepositContactLinks(');
  const end=script.indexOf('\nfunction getHardwareCounts()',start);
  const source=script.slice(start,end);
  assert.ok(start>=0&&end>start,'Deposit contact action builder is present.');
  const make=(order)=>{
    const links=[{href:'',hidden:false,classList:{contains:()=>false},setAttribute(name,value){this[name]=value;}},{href:'',hidden:true,classList:{contains:()=>true},setAttribute(name,value){this[name]=value;}}];
    const successNote={hidden:true};
    const document={querySelector(selector){if(selector==='#name')return{value:'Jordan Example'};if(selector==='[data-estimate-price]')return{textContent:'$1,980.00 – $2,178.00'};if(selector==='[data-deposit-success-note]')return successNote;return null;},querySelectorAll(){return links;}};
    const update=new Function('document','serviceSelect','customQuoteService','submittedOrderNumber','currentEstimatedDeposit',`${source};updateDepositContactLinks();return {links:document.querySelectorAll('[data-deposit-contact]'),successNote:document.querySelector('[data-deposit-success-note]')};`);
    return update(document,{value:'Shower Doors'},'',order,990);
  };
  const pending=make('');
  assert.equal(pending.links[0].href,'#submit-quote-request','An unsubmitted request does not receive an invented Order Number.');
  assert.equal(pending.links[1].hidden,true);
  const submitted=make('BGM-2026-01234');
  const mail=decodeURIComponent(submitted.links[1].href);
  assert.match(mail,/^mailto:office@brunosglass\.com\?subject=Bruno’s Instant Quote — Deposit Follow-up — BGM-2026-01234&body=/);
  for(const item of ['Jordan Example','Order Number: BGM-2026-01234','Project type: Shower Doors','Estimated range: $1,980.00 – $2,178.00','Estimated 50% deposit: $990'])assert.ok(mail.includes(item),`Email includes ${item}.`);
  assert.doesNotMatch(mail,/PRIVATE ACCESS CODE|never-include-code|sb_publishable_|OPENAI_API_KEY/i,'No private code or API credential enters the mailto body.');
  assert.equal(submitted.successNote.hidden,false);
});

test('referral codes display safely and travel in the existing quote message', () => {
  assert.match(script, /new URLSearchParams\(window\.location\.search\)\.get\('ref'\)/);
  assert.match(script, /Object\.hasOwn\(referralNameByCode, referralCandidate\)/);
  assert.doesNotMatch(script, /referralNameByCode\[referralCode\] \|\| referralCode\.replace/);
  assert.match(script, /quoteReferralNote\.textContent = `Referred by \$\{referralName\}`/);
  assert.match(script, /referralCode \? `Referral code: \$\{referralCode\}`/);
  for (const code of ['jeff', 'tony', 'hamy']) {
    const path = `images/referral-qr/${code}.png`;
    const png = readFileSync(new URL(`../${path}`, import.meta.url));
    assert.deepEqual([...png.subarray(0, 8)], [137,80,78,71,13,10,26,10], `${path} is a PNG`);
    assert.ok(html.includes(`/?ref=${code}#quote`));
    assert.ok(html.includes(path));
    const stagingPng = readFileSync(new URL(`../staging-assets/referral-qr/${code}.png`, import.meta.url));
    assert.deepEqual([...stagingPng.subarray(0, 8)], [137,80,78,71,13,10,26,10], `Staging QR ${code} is a PNG.`);
  }
  assert.match(readFileSync(new URL('../scripts/prepare-staging.mjs', import.meta.url), 'utf8'), /staging-assets','referral-qr/);
  assert.match(html, /No commission is calculated or paid through this site\./);
});

test('backend tracking credentials get a prominent copy-and-track success card', () => {
  for (const copy of ['QUOTE REQUEST RECEIVED','SAVE YOUR PROJECT ACCESS','ORDER NUMBER','PRIVATE ACCESS CODE','COPY BOTH','TRACK MY PROJECT','SAVE OR SCREENSHOT THESE DETAILS','You will need BOTH to track your project and view your Final Quote.']) assert.ok(html.includes(copy), `Success card includes ${copy}.`);
  assert.match(html, /data-copy-credential="order"/);
  assert.match(html, /data-copy-credential="code"/);
  assert.match(html, /data-copy-both/);
  assert.match(html, /href="#tracking"[^>]*>TRACK MY PROJECT/);
  assert.match(script, /result\?\.trackingNumber/);
  assert.match(script, /result\?\.accessCode/);
  assert.match(script, /Bruno's Glass & Mirror\\nOrder Number: \$\{order\}\\nPrivate Access Code: \$\{code\}/);
  assert.match(script, /focusTarget\.focus\(\{preventScroll:true\}\);\s*scrollToQuoteContent\(hasCredentials \? credentialCard : confirmation\)/);
  assert.match(script, /button\.textContent = 'COPIED ✓'/);
  assert.match(experienceCss, /credential-card-enter/);
  assert.match(experienceCss, /credential-value-emphasis/);
  assert.match(experienceCss, /credential-track-attention/);
  assert.match(experienceCss, /@media\(prefers-reduced-motion:reduce\)[\s\S]*?tracking-credentials\.is-entering[\s\S]*?animation:none/);
  assert.match(experienceCss, /@media\(max-width:760px\)[\s\S]*?credential-item[\s\S]*?grid-template-columns:1fr/);
  assert.match(html, /name="orderNumber"[^>]*required/);
  assert.match(html, /name="accessCode"[^>]*required/);
  assert.doesNotMatch(html.match(/<div class="tracking-credentials"[\s\S]*?<\/div>/)?.[0] || '', /href="[^"]*accessCode/i);
});

test('sales contact and Admin display use current quote data without claiming email delivery', () => {
  assert.match(html, /Jeff Kruse · Director of Sales/);
  assert.match(html, /tel:\+19548725065/);
  assert.match(html, /mailto:Sales@brunoglass\.com/);
  assert.match(html, /mailto:office@brunosglass\.com/);
  assert.doesNotMatch(html, /hamidou@brunoglass\.com/i);
  assert.match(admin, /Customer range/);
  assert.match(adminScript, /function storedBaseEstimateLabel\(quote\)/);
  assert.match(adminScript, /Number\(quote\.estimated_price \?\? quote\.estimated_price_low\)/);
  assert.match(adminScript, /function referralSourceLabel\(quote\)/);
  assert.match(workflow, /Estimated customer range \(saved\)/);
  assert.match(workflow, /Referral source \(from request message\)/);
  assert.match(workflow, /estimated deposit is 50% of the base estimate/);
});

test('office is the operational contact without embedded credentials or a false delivery claim', () => {
  assert.match(html, /mailto:office@brunosglass\.com/);
  assert.doesNotMatch(html, /hamidou@brunoglass\.com/i);
  assert.match(readFileSync(new URL('../admin.html', import.meta.url), 'utf8'), /type="password"/);
  assert.match(adminScript, /signInWithPassword\(\{\s*email,\s*password\s*\}\)/);
  assert.doesNotMatch(adminScript, /password\s*[:=]\s*['"][^'"]+['"]/i);
  assert.doesNotMatch(html + adminScript, /notification.{0,30}(sent|delivered)|email.{0,30}(sent|delivered)/i);
});

test('measurement and active tracking language stays explicit and responsive styles cover requested sizes', () => {
  assert.match(readFileSync(new URL('../measurement.js', import.meta.url), 'utf8'), /AI dimensions are approximate, not verified/);
  assert.match(readFileSync(new URL('../measurement.js', import.meta.url), 'utf8'), /professional field measurement is required before fabrication/);
  assert.match(html, /id="tracking"/);
  assert.match(html, /Both are required\./);
  assert.match(html, /Online tracking does not collect or charge payments/);
  assert.match(script, /Measure width and height with a tape\. Edit either value before pricing\./);
  assert.match(css, /@media\(max-width:1000px\)/);
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /@media\(max-width:380px\)/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});

test('dist contains the synchronized current frontend and presentation assets', () => {
  for (const file of ['index.html','favicon.ico','quote-app.js','quote-experience.css','script.js','style.css','admin.html','admin.js','admin.css','project-cart.css','project-cart.js','project-workflow.css','project-workflow.js','project-tracking.css','project-tracking.js','measurement.js','tracking-status.js','quote-document.mjs']) {
    assert.deepEqual(readFileSync(new URL(`../${file}`, import.meta.url)),readFileSync(new URL(`../dist/${file}`, import.meta.url)),`${file} matches dist`);
  }
  for (const file of ['images/magazine/glass-stair-railing-reference.jpg','images/magazine/glass-door-reference.jpg','images/referral-qr/jeff.png','images/referral-qr/tony.png','images/referral-qr/hamy.png','images/projects/bruno-residential-glass-enclosures.jpg',...['architectural-glass','shower-sliding','shower-swing-fixed','shower-corner','shower-walk-in','shower-tub','shower-undecided','tub-sliding','tub-swing-fixed'].map(name=>`images/configurations/${name}.svg`)]) {
    assert.deepEqual(readFileSync(new URL(`../${file}`, import.meta.url)),readFileSync(new URL(`../dist/${file}`, import.meta.url)),`${file} matches dist`);
  }
});
