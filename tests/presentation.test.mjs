import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('../script.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const admin = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const adminScript = readFileSync(new URL('../admin.js', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../project-workflow.js', import.meta.url), 'utf8');
const root = new URL('../', import.meta.url);
const dist = new URL('../dist/', import.meta.url);
const decode = value => value.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#8217;', '’');

test('magazine services and local Bruno project images are present', () => {
  const services = [
    'Custom Shower Enclosures', 'Custom Mirrors', 'Glass Railings & Balcony Systems',
    'Commercial Interior Glazing / Glass Partitions', 'Wine Room Enclosures', 'Glass Floors',
    'Back Painted Glass', 'Textured & Decorative Glass', 'Smart Glass / Privacy Glass',
    'Custom Fabrication & Finishes'
  ];
  const page = decode(html);
  for (const service of services) assert.ok(page.includes(service), `Missing service: ${service}`);
  for (const path of [
    'images/work-04.jpeg',
    'images/inspiration/tmpt1njs01e.webp',
    'images/inspiration/tmpalrn5bjl.webp',
    'images/inspiration/WhatsApp Image 2026-09-11 at 5.43.08 PM (1).jpeg',
    'images/projects/bruno-residential-glass-enclosures.jpg',
    'images/inspiration/WhatsApp Image 2026-09-14 at 3.48.36 PM.jpeg'
  ]) assert.ok(existsSync(new URL(path, root)), `Missing local image: ${path}`);
  assert.doesNotMatch(script.slice(script.indexOf('const products = ['), script.indexOf('// PRODUCT GALLERY')), /https?:\/\//,
    'Priced product previews should use supplied Bruno photographs rather than remote stock images.');
});

test('quotation-first entry contains distinct and correctly grouped reference crops', () => {
  assert.match(html, /<h1 id="sales-hero-title">Start Your Estimate<\/h1>/);
  assert.equal((html.match(/class="official-logo"/g) || []).length, 1, 'The public header has one logo.');
  assert.equal((html.match(/class="entry-card"/g) || []).length, 15, 'Every supplied reference tile is represented individually.');
  const groups = {
    'entry-showers': ['shower-sliding','shower-swing-fixed','shower-corner','shower-walk-in','shower-tub','shower-not-sure'],
    'entry-mirrors': ['mirror-custom','mirror-backlit','mirror-wall','mirror-framed'],
    'entry-architectural': ['glass-partitions','glass-railings','glass-wine-room','glass-doors','glass-tabletops']
  };
  for (const [group, names] of Object.entries(groups)) {
    const block = html.match(new RegExp(`<section class="entry-category ${group}">([\\s\\S]*?)<\\/section>`))?.[1];
    assert.ok(block, `Missing ${group} category.`);
    for (const name of names) {
      assert.ok(block.includes(`images/reference/${name}.jpg`), `${name} is in its expected category.`);
      assert.ok(existsSync(new URL(`../images/reference/${name}.jpg`, import.meta.url)), `${name} crop exists.`);
    }
  }
  assert.doesNotMatch(html, /category-info-card[\s\S]{0,180}tmpalrn5bjl\.webp/);
  assert.match(script, /Commercial Interior Glazing \/ Glass Partitions': \{src:'images\/reference\/glass-partitions\.jpg'/);
  assert.match(script, /'Glass Door': \{src:'images\/reference\/glass-doors\.jpg'/);
});

test('custom services use the existing request fields without inventing an estimate', () => {
  assert.match(html, /id="custom-quote-selection"/);
  assert.match(html, /id="photos"[\s\S]*?type="file"/);
  assert.match(script, /const customLabels = \['Project Type', 'Measurements', 'Your Information', 'Review Request'\]/);
  assert.match(script, /const customPanelIndexes = \[0,1,5,6\]/);
  assert.match(script, /customQuoteService \? 'Custom quote — no automatic pricing'/);
  assert.match(script, /Requested custom service: \$\{customQuoteService\}/);
  assert.match(script, /const price = customQuoteService\s*\? 'Custom quote — estimate prepared after review\.'/);
  assert.match(script, /if \(customQuoteService\) \{\s*renderEstimateDisplays\(null, 'Custom quote — Bruno will prepare an estimate after reviewing your project\.'\);\s*return;/);
  assert.match(html, /professional field measurement by Bruno’s team/i);
});

test('Glass Door is a custom quote with a magazine door reference, and selections update contextual imagery', () => {
  assert.match(html, /<h3>Glass Doors?<\/h3>[\s\S]*?data-custom-service="Glass Door"/);
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

test('customer display range adds $150 above central high without changing base or deposit', () => {
  const source = script.match(/function renderEstimateDisplays\(estimate, pendingMessage = ''\) \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(source, 'The live estimate presentation function is present.');
  const nodes = new Map();
  for (const selector of ['[data-estimate-price]', '[data-estimate-base]', '[data-estimate-deposit]', '[data-estimate-breakdown]']) {
    nodes.set(selector, [
      {textContent:'',hidden:true,classList:{toggle(){}},animate(){}},
      ...(selector === '[data-estimate-price]' ? [{textContent:'',classList:{toggle(){}},animate(){}}] : [])
    ]);
  }
  const document = {querySelectorAll:selector => nodes.get(selector),querySelector:selector => nodes.get(selector)?.[0]};
  const window = {matchMedia:() => ({matches:true})};
  const render = new Function('estimate','pendingMessage','customQuoteService','document','window','serviceSelect',`"use strict";${source}`);
  for (const [low,high,expectedRange,expectedBase,expectedDeposit] of [
    [1800,1800,'$1,800.00 – $1,950.00','Base estimate: $1,800.00','$900.00']
  ]) {
    render({complete:true,low,high,breakdown:{material:low,frame:0,enduroShield:0}},'','',document,window,{value:'Glass'});
    assert.deepEqual(nodes.get('[data-estimate-price]').map(node=>node.textContent),[expectedRange,expectedRange]);
    assert.equal(nodes.get('[data-estimate-base]')[0].textContent,expectedBase);
    assert.equal(nodes.get('[data-estimate-deposit]')[0].textContent,expectedDeposit);
  }
  render({complete:true,low:2400,high:2400,breakdown:{material:1800,frame:600,enduroShield:0}},'','',document,window,{value:'Mirror'});
  assert.equal(nodes.get('[data-estimate-price]')[0].textContent,'$2,400.00 – $2,550.00');
  assert.equal(nodes.get('[data-estimate-breakdown]')[0].textContent,'Mirror: $1,800.00 · Metal / Frame: $600.00');
  assert.match(script, /estimated_price:\s*completeEstimate\s*\?\s*\(completeEstimate\.low \+ completeEstimate\.high\) \/ 2/);
  assert.match(script, /estimated_price_high:\s*completeEstimate\s*\?\s*completeEstimate\.high/);
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
    assert.ok(html.includes(`https://brunos-glass-mirror.english-academy-fl.workers.dev/?ref=${code}`));
    assert.ok(html.includes(path));
  }
  assert.match(html, /No commission is calculated or paid through this site\./);
});

test('sales contact and Admin display use current quote data without claiming email delivery', () => {
  assert.match(html, /Jeff Kruse · Director of Sales/);
  assert.match(html, /tel:\+19548725065/);
  assert.match(html, /mailto:Sales@brunoglass\.com/);
  assert.match(html, /mailto:office@brunosglass\.com/);
  assert.doesNotMatch(html, /hamidou@brunoglass\.com/i);
  assert.match(admin, /Customer range/);
  assert.match(adminScript, /function storedBaseEstimateLabel\(quote\)/);
  assert.match(adminScript, /function referralSourceLabel\(quote\)/);
  assert.match(workflow, /Customer display range \(derived, not saved\)/);
  assert.match(workflow, /Referral source \(from request message\)/);
  assert.match(workflow, /The stored estimate and pricing calculation are unchanged/);
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
  assert.match(html, /Measurements entered online are preliminary and used for estimating only/);
  assert.match(html, /Professional field measurement remains required before fabrication/);
  assert.match(html, /id="tracking"/);
  assert.match(html, /Both are required to view project details/);
  assert.match(html, /Online tracking does not collect or charge payments/);
  assert.match(html, /Photo-based measurement and visualization are not available yet/);
  assert.match(css, /@media\(max-width:1000px\)/);
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /@media\(max-width:380px\)/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});

test('dist contains the synchronized current frontend and presentation assets', () => {
  for (const file of ['index.html','script.js','style.css','admin.html','admin.js','admin.css','project-cart.css','project-cart.js','project-workflow.css','project-workflow.js','project-tracking.css','project-tracking.js','measurement.js','quote-app.js','quote-experience.css','tracking-status.js','quote-document.mjs']) {
    assert.deepEqual(readFileSync(new URL(`../${file}`, import.meta.url)),readFileSync(new URL(`../dist/${file}`, import.meta.url)),`${file} matches dist`);
  }
  for (const file of ['images/magazine/glass-stair-railing-reference.jpg','images/magazine/glass-door-reference.jpg','images/referral-qr/jeff.png','images/referral-qr/tony.png','images/referral-qr/hamy.png','images/projects/bruno-residential-glass-enclosures.jpg',...['architectural-glass','shower-sliding','shower-swing-fixed','shower-corner','shower-walk-in','shower-tub','shower-undecided'].map(name=>`images/configurations/${name}.svg`)]) {
    assert.deepEqual(readFileSync(new URL(`../${file}`, import.meta.url)),readFileSync(new URL(`../dist/${file}`, import.meta.url)),`${file} matches dist`);
  }
});
