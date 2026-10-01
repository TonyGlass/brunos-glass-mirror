import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createPreliminaryDocument, createFinalQuoteDocument, renderFinalQuoteHtml} from '../quote-document.mjs';
import {prepareQuoteConfirmation, deliverQuoteConfirmation} from '../supabase/functions/_shared/quote-email.mjs';

const context = vm.createContext({AbortController, Intl});
vm.runInContext(readFileSync(new URL('../measurement.js',import.meta.url),'utf8'),context);
vm.runInContext(readFileSync(new URL('../tracking-status.js',import.meta.url),'utf8'),context);
const measurement = context.BrunoMeasurement;
const plain = object => JSON.parse(JSON.stringify(object));

test('unavailable measurement provider never fabricates dimensions or replaces fractional manual input',async()=>{
  const session = measurement.createSession();
  session.edit('60 1/4','72 1/8');
  const result = await session.analyze([{type:'image/png'}]);
  assert.equal(result.status,'unavailable');
  assert.equal(result.suggestion,null);
  assert.equal(result.width,'60 1/4'); assert.equal(result.height,'72 1/8');
  assert.equal(session.useSuggestion(),null);
  assert.equal(session.confirm().confirmed,true);
  assert.equal(session.edit('60 3/16','72 1/8').confirmed,false);
});

test('suggestions are approximate, opt-in and subordinate to customer corrections',async()=>{
  const session = measurement.createSession({available:true,measure:async()=>({status:'suggested',unit:'in',width:60.25,height:72.125,confidence:.8,quality:'Reference scale required'})});
  session.edit('61','73');
  const result = await session.analyze([]);
  assert.equal(result.suggestion.approximate,true);
  assert.equal(result.suggestion.confidence,.8);
  assert.equal(result.width,'61','No automatic adoption');
  assert.equal(session.useSuggestion().width,'60 1/4');
  assert.equal(session.snapshot().height,'72 1/8');
  session.edit('62 1/16','74');
  assert.equal(session.snapshot().width,'62 1/16');
  assert.equal(session.snapshot().source,'customer');
  assert.equal(measurement.inches(60.123), '60.123','No rounding into fabricated precision');
});

test('invalid, failed, canceled and stale provider responses cannot alter manual values',async()=>{
  for (const suggestion of [{width:-1,height:72},{width:60,height:NaN},{width:60,height:72,confidence:1.1},{width:'60',height:72},{width:60,height:72,unit:'cm'}]) {
    assert.equal(measurement.normalizeSuggestion({status:'suggested',unit:'in',...suggestion}),null);
  }
  const failed = measurement.createSession({measure:async()=>{throw Error('offline')}});
  failed.edit('60','72'); assert.equal((await failed.analyze([])).status,'error'); assert.equal(failed.snapshot().width,'60');
  const resolve = [];
  const session = measurement.createSession({available:true,measure:()=>new Promise(done=>resolve.push(done))});
  const first = session.analyze([]), second = session.analyze([]);
  session.edit('99 1/8','88');
  resolve[1]({status:'suggested',unit:'in',width:60,height:72}); await second;
  resolve[0]({status:'suggested',unit:'in',width:20,height:30}); assert.equal(await first,null);
  assert.equal(session.snapshot().suggestion.width,60);
  assert.equal(session.snapshot().width,'99 1/8');
  const third = session.analyze([]); session.cancel(); resolve[2]({status:'suggested',unit:'in',width:10,height:10});
  assert.equal(await third,null); assert.equal(session.snapshot().suggestion,null);
});

test('recommendations require entered shower facts and never infer geometry or clearance from photos',()=>{
  assert.deepEqual(plain(measurement.recommend({projectType:'Mirror',placement:'tub'})),[]);
  assert.deepEqual(plain(measurement.recommend({projectType:'Glass',openingGeometry:'corner'})),[]);
  assert.deepEqual(plain(measurement.recommend({projectType:'Shower Doors',measurements:{width:60,height:72},photoAnalysis:{shape:'corner'}})),[]);
  assert.equal(measurement.recommend({projectType:'Shower Doors',placement:'tub'})[0].configuration,'Tub Enclosure');
  assert.equal(measurement.recommend({projectType:'Shower Doors',placement:'shower',openingGeometry:'corner'})[0].configuration,'90° Corner');
  assert.deepEqual(plain(measurement.recommend({projectType:'Shower Doors',placement:'shower',openingGeometry:'straight',availableClearance:10})),[]);
});

test('vision integration is a server-only classifier with no dimension output and honest unavailable fallback',()=>{
  const endpoint=readFileSync(new URL('../supabase/functions/analyze-photo/index.ts',import.meta.url),'utf8');
  assert.match(endpoint,/Deno\.env\.get\('OPENAI_API_KEY'\)/);
  assert.match(endpoint,/api\.openai\.com\/v1\/responses/);
  assert.match(endpoint,/store:false/);
  assert.match(endpoint,/if\(!key\)return reply\(\{error:'Photo analysis is not configured/);
  assert.match(endpoint,/upstream durable rate limit/);
  assert.doesNotMatch(endpoint,/width\s*:\s*\{|height\s*:\s*\{|"width"\s*,\s*"height"/);
  const client=readFileSync(new URL('../measurement.js',import.meta.url),'utf8');
  assert.match(client,/data-analyze-photo/);
  assert.match(client,/Photo analysis does not measure dimensions/);
  assert.match(client,/Manual configuration and tape measurements remain available/);
  assert.doesNotMatch(client,/OPENAI_API_KEY/);
});

test('six shower layouts map to distinct category-matched cropped photos',()=>{
  const source=readFileSync(new URL('../script.js',import.meta.url),'utf8');
  const models=new Function(`return ${source.match(/const products = (\[[\s\S]*?\n\]);/)[1]}`)();
  const expected = {'Sliding Door':'shower-sliding','Swing Door + Fixed Panel':'shower-swing-fixed','90° Corner':'shower-corner','Fixed Panel / Walk-In':'shower-walk-in','Tub Enclosure':'shower-tub','Not Sure / Let Bruno’s recommend it':'shower-not-sure'};
  assert.equal(models.length,6);
  for (const model of models) {
    assert.equal(model.service,'Shower Doors');
    assert.equal(model.image,`images/reference/${expected[model.name]}.jpg`);
    assert.ok(readFileSync(new URL('../'+model.image,import.meta.url)).length>1000);
  }
});

const quote = {tracking_number:'BGM-2026-00001',name:'Customer',phone:'9545550100',email:'customer@example.com',installation_address:'123 Example St',city:'Hollywood',service:'Shower Doors',product:'Sliding Door',glass_type:'Low-Iron Glass - 3/8',width:60.25,height:72.125,square_feet:30.1773,quantity:1,message:'Please review clearance',estimated_price_low:1800,estimated_price_high:1800,created_at:'2026-09-30T12:00:00Z',final_price:2400,final_quote_draft_price:99999,tracking_token_hash:'never-copy',accessCode:'never-copy'};
test('preliminary document supports PDF fields without becoming an authoritative Final Quote or receipt',()=>{
  const document = createPreliminaryDocument({quote,pricingRevision:3,dimensions:{widthText:'60 1/4',heightText:'72 1/8'},options:['EnduroShield'],photos:[{name:'opening.png',storagePath:'quotes/abc/opening.png',signedUrl:'https://secret',caption:'Opening'}],preparedAt:'2026-09-30T13:00:00Z'});
  assert.equal(document.kind,'preliminary-estimate'); assert.equal(document.authoritative,false);
  assert.equal(document.orderNumber,quote.tracking_number);
  assert.equal(document.customer.address,quote.installation_address);
  assert.equal(document.project.measurements.width,'60 1/4'); assert.equal(document.project.measurements.approximate,true);
  assert.equal(document.project.photos[0].storagePath,'quotes/abc/opening.png');
  assert.deepEqual(document.pricing.baseEstimate,{low:1800,high:1800});
  assert.deepEqual(document.pricing.customerEstimateRange,{low:1800,high:1950});
  assert.deepEqual(document.pricing.estimatedDeposit,{low:900,high:900});
  assert.equal(document.pricing.finalPrice,null); assert.equal(document.pricing.finalApprovedPrice,null); assert.equal(document.pricing.finalDeposit,null);
  assert.equal(document.pricingRevision,3);
  assert.match(document.disclaimer,/professional review and field measurement/);
  assert.deepEqual(document.delivery,{pdfGenerated:false,emailSent:false});
  assert.doesNotMatch(JSON.stringify(document),/never-copy|tracking_token|final_quote_draft|signedUrl|https:\/\/secret/);
});

test('missing prices stay unknown and Final Quote requires published Admin price, never the estimate or draft',()=>{
  const missing=createPreliminaryDocument({quote:{estimated_price_low:null,estimated_price_high:null,final_price:999}});
  assert.equal(missing.pricing.baseEstimate,null); assert.equal(missing.pricing.estimatedDeposit,null); assert.equal(missing.pricingRevision,null);
  assert.throws(()=>createFinalQuoteDocument({quote}),/published Admin Final Quote/);
  assert.throws(()=>createFinalQuoteDocument({quote:{...quote,final_quote_sent_at:'2026-09-30',final_price:null}}),/valid final price/);
  const published={...quote,final_quote_sent_at:'2026-09-30T13:00:00Z',final_quote_scope:'Published scope',final_quote_date:'2026-09-30',final_quote_expires_at:'2026-10-30'};
  const final=createFinalQuoteDocument({quote:published});
  assert.equal(final.authoritative,true); assert.equal(final.pricing.finalPrice,2400); assert.equal(final.pricing.finalDeposit,1200); assert.equal(final.pricing.finalApprovedPrice,null);
  assert.equal(final.pricing.estimatedDeposit,null); assert.equal(final.project.measurements.approximate,true);
  const printable=renderFinalQuoteHtml(final);
  assert.match(printable,/Final Project Quote/);assert.match(printable,/\$2,400\.00/);assert.match(printable,/\$1,200\.00/);
  assert.match(printable,/Email delivery is not configured|payment receipt is issued separately/i);
  assert.throws(()=>renderFinalQuoteHtml(createPreliminaryDocument({quote})),/published Admin Final Quote/);
  const accepted=createFinalQuoteDocument({quote:{...published,final_quote_accepted_at:'2026-10-01',measurement_completed_at:'2026-09-30',verified_width:'61 1/16',verified_height:'73'}});
  assert.equal(accepted.pricing.finalApprovedPrice,2400); assert.equal(accepted.project.measurements.approximate,false);
});

const emailInput={to:'customer@example.com',orderNumber:'BGM-2026-00001',accessCode:'a'.repeat(43),trackingUrl:'https://example.com/#tracking'};
test('email preparation is server-only and default delivery cannot pretend to send',async()=>{
  const message=prepareQuoteConfirmation(emailInput);
  assert.equal(message.delivery.sent,false); assert.equal(message.attachments.length,0);
  assert.match(message.text,/Enter both your order number and private access code/);
  assert.deepEqual(await deliverQuoteConfirmation(message),{status:'not-configured',sent:false});
  assert.throws(()=>prepareQuoteConfirmation({...emailInput,accessCode:null}),/Backend-issued/);
  assert.throws(()=>prepareQuoteConfirmation({...emailInput,trackingUrl:'https://example.com/?code=secret'}),/without embedded credentials/);
  assert.throws(()=>prepareQuoteConfirmation({...emailInput,finalQuoteUrl:'https://example.com/final',finalQuoteDocument:createPreliminaryDocument({quote})}),/published Admin/);
  const provider={send:async()=>({status:'accepted',messageId:'test-only'})};
  await assert.rejects(deliverQuoteConfirmation(message,{provider}),/idempotency/);
  assert.deepEqual(await deliverQuoteConfirmation(message,{provider,idempotencyKey:'local-1'}),{status:'accepted',messageId:'test-only',delivered:false});
});

test('tracking stages do not fabricate historical progression or infer payment verification',()=>{
  const unknown=context.BrunoTrackingStatus.stages({});
  assert.equal(unknown.length,8); assert.ok(unknown.every(stage=>/not recorded|No published/.test(stage.detail)));
  const completed=context.BrunoTrackingStatus.stages({status:'Completed',payment:{received:0},finalQuote:{status:'Not published'}});
  assert.equal(completed.find(stage=>stage.label==='Fabrication').detail,'Fabrication progress not recorded');
  assert.equal(completed.find(stage=>stage.label==='Deposit / payment').detail,'Payment verification not recorded');
  assert.equal(completed.at(-1).detail,'Current status: Completed');
});
