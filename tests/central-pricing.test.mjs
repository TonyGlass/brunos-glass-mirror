import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { calculateEstimatedPrice } from '../supabase/functions/_shared/pricing-engine.mjs';
import { normalizePricingConfig, normalizeProject, publicEstimate, quoteEstimateFields } from '../supabase/functions/_shared/pricing-contract.mjs';
import { createPricingHandler } from '../supabase/functions/_shared/pricing-handler.mjs';

// Synthetic test-only inputs. Never imported by runtime code or saved to Supabase.
export const fixture = () => normalizePricingConfig({profitMargin:.30,
  glassCosts:{'low-iron-glass-3-8':{low:2.96,high:3.74}},
  mirrorCosts:{'clear-mirror-1-4':{low:4,high:6}},
  glassLowIron38SplitPerLite:{value:35},
  fabrication:{low:20,high:20}, installationLabor:{low:30,high:30},
  consumables:{low:5,high:5}, other:{low:0,high:0},
  hardware:Object.fromEntries(['hinges','handles','clips','sweeps','channels','accessories'].map(k=>[k,{low:3,high:4}]))});
export const shower = {service:'Shower Doors',glassType:'Low-Iron Glass - 3/8',width:67.625,height:95.0625,quantity:1,counts:{hinges:2}};
export const mirror = {service:'Mirror',glassType:'Clear Mirror - 1/4',width:24,height:36,quantity:1,counts:{}};
const confirmedRates = normalizePricingConfig({pricingModel:'selling-rates-v1',enduroShieldRate:7,finalSellingRates:{
  'clear-glass-3-8':45,'low-iron-glass-3-8':60,'reeded-moru-3-8':80,'satin-acid-etched-3-8':75,
  'satin-acid-etched-low-iron-3-8':120,'clear-glass-1-2':55,'low-iron-glass-1-2':70,
  'clear-mirror-1-4':45,'low-iron-mirror-1-4':65,'bronze-mirror-1-4':75,'gray-mirror-1-4':75,'metal-frame':15
}});

function backend() {
  let record = null;
  const handler = createPricingHandler({allowedOrigins:new Set(['http://127.0.0.1:8000']),
    requireAdmin:async r=>['admin-a','admin-b'].includes(r.headers.get('authorization')) ? {id:r.headers.get('authorization')} : null,
    read:async()=>structuredClone(record),
    save:async(config,revision,user)=>{if ((record?.revision || 0)!==revision)return null;
      record={config,revision:revision+1,updated_by:user};return structuredClone(record);}});
  const call = (body,token='public') => handler(new Request('https://local/pricing',{method:'POST',headers:{authorization:token},body:JSON.stringify(body)}));
  return {call};
}

test('Admin save, fresh sessions, public projection, denial and optimistic concurrency',async()=>{
  const {call}=backend();
  assert.equal((await call({action:'read'})).status,403);
  assert.equal((await call({action:'save',config:fixture(),expectedRevision:0})).status,403);
  assert.equal((await call({action:'save',config:fixture(),expectedRevision:0},'ordinary-user')).status,403);
  assert.equal((await call({action:'save',config:fixture(),expectedRevision:0},'admin-a')).status,200);
  const saved=await (await call({action:'read'},'admin-b')).json();
  assert.deepEqual(saved.pricing.config,fixture());
  assert.equal((await call({action:'save',config:fixture(),expectedRevision:0},'admin-b')).status,409);
  for (const project of [shower,mirror]) {
    const a=await (await call({action:'estimate',project},'fresh-anonymous-device')).json();
    const b=await (await call({action:'estimate',project},'another-device')).json();
    assert.deepEqual(a,b);
    assert.equal(a.estimate.complete,true);
    assert.deepEqual(Object.keys(a.estimate).sort(),['complete','high','low','revision']);
    assert.equal(JSON.stringify(a).includes('profitMargin'),false);
    const calc=calculateEstimatedPrice(normalizeProject(project),fixture());
    assert.equal(a.estimate.low,calc.low);assert.equal(a.estimate.high,calc.high);
    assert.equal(quoteEstimateFields(a.estimate).final_price,null);
  }
});

test('unknown costs stay unavailable; invalid costs never become zero',()=>{
  const config=fixture();config.fabrication.low=null;
  assert.equal(publicEstimate(shower,{config,revision:1}).complete,false);
  assert.equal(publicEstimate(shower,null).complete,false);
  config.fabrication.low='';
  assert.throws(()=>normalizePricingConfig(config));
  assert.throws(()=>normalizeProject({...shower,counts:{hinges:-1}}));
  assert.throws(()=>normalizeProject({...shower,width:NaN}));
});

test('approved Glass and Mirror catalogs use exact area and supported optional charges',()=>{
  const cases=[
    ['Clear Glass - 3/8',45],['Low-Iron Glass - 3/8',60],['Reeded / Moru - 3/8',80],
    ['Satin Acid-Etched - 3/8',75],['Satin Acid-Etched Low-Iron - 3/8',120],
    ['Clear Glass - 1/2',55],['Low-Iron Glass - 1/2',70]
  ];
  for(const [glassType,rate] of cases){
    const result=calculateEstimatedPrice({service:'Shower Doors',glassType,squareFeet:1,quantity:1,counts:{hinges:99,handles:22}},confirmedRates);
    assert.deepEqual({complete:result.complete,low:result.low,high:result.high},{complete:true,low:rate,high:rate},glassType);
  }
  for(const glassType of ['Bronze Mirror - 1/4','Gray Mirror - 1/4']){
    const result=calculateEstimatedPrice({service:'Mirror',glassType,squareFeet:40,quantity:1},confirmedRates);
    assert.equal(result.low,3000,glassType);
    assert.equal(result.low*.5,1500,glassType);
  }
  assert.throws(()=>normalizeProject({service:'Glass',glassType:'Clear Glass - 1/4',width:60,height:96,quantity:1}),/approved automatic-pricing catalog/);
  assert.throws(()=>normalizeProject({service:'Glass',glassType:'Low-Iron Glass - 1/4',width:60,height:96,quantity:1}),/approved automatic-pricing catalog/);
  assert.throws(()=>normalizeProject({service:'Glass',glassType:'Clear Glass - 5/8',width:60,height:96,quantity:1}),/approved automatic-pricing catalog/);
  const glassProject={service:'Glass',glassType:'Low-Iron Glass - 3/8',width:60,height:72,quantity:1,enduroShield:false};
  const glassNormalized=normalizeProject(glassProject);
  assert.equal(glassNormalized.squareFeet,30);
  const glassEstimate=publicEstimate(glassProject,{config:confirmedRates,revision:2});
  assert.equal(glassEstimate.low,1800);assert.equal(glassEstimate.high,1800);
  assert.equal(glassEstimate.low+150,1950);
  const brunoExample=normalizeProject({service:'Mirror',glassType:'Clear Mirror - 1/4',width:60,height:96,quantity:1,mirrorFrame:false});
  assert.equal(brunoExample.squareFeet,40);
  const clearEstimate=calculateEstimatedPrice(brunoExample,confirmedRates);
  assert.equal(clearEstimate.low,1800);assert.equal(clearEstimate.high,1800);
  assert.equal(clearEstimate.low+150,1950);
  assert.equal(clearEstimate.breakdown.frame,0);
  const framed=normalizeProject({service:'Mirror',glassType:'Clear Mirror - 1/4',width:60,height:96,quantity:1,mirrorFrame:true});
  const framedEstimate=publicEstimate({...framed},{config:confirmedRates,revision:2});
  assert.deepEqual(framedEstimate.breakdown,{material:1800,frame:600,enduroShield:0});
  assert.equal(framedEstimate.low,2400);assert.equal(framedEstimate.high+150,2550);
  assert.equal(confirmedRates.profitMargin,null);
  const project={service:'Shower Doors',glassType:'Low-Iron Glass - 3/8',width:60,height:72,quantity:1,counts:{hinges:3}};
  const area=normalizeProject(project).squareFeet;
  assert.equal(area,30);
  const base=calculateEstimatedPrice({...normalizeProject(project),counts:{hinges:3}},confirmedRates);
  assert.equal(base.low,1800);assert.equal(base.low*.5,900);
  const coated=calculateEstimatedPrice({...normalizeProject(project),enduroShield:true,counts:{hinges:3}},confirmedRates);
  assert.equal(coated.low,2010);assert.equal(coated.low*.5,1005);
  assert.deepEqual(coated.breakdown,{material:1800,frame:0,enduroShield:210});
  const incomplete=normalizePricingConfig({pricingModel:'selling-rates-v1',enduroShieldRate:7,finalSellingRates:{'low-iron-glass-3-8':60}});
  assert.equal(calculateEstimatedPrice({...normalizeProject(project),enduroShield:false},incomplete).low,1800);
  assert.equal(quoteEstimateFields({complete:true,low:1800,high:1800}).estimated_price,1800);
  assert.equal(quoteEstimateFields({complete:true,low:1800,high:1800}).final_price,null);
});

test('customer catalogs are project-specific and frame controls are Mirror-only',()=>{
  const script=readFileSync(new URL('../script.js',import.meta.url),'utf8');
  const catalog=(name)=>{
    const source=script.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\n\\];`))?.[1];
    assert.ok(source,`${name} exists`);
    return [...source.matchAll(/\['([^']+)','([^']+)'\]/g)].map(([,value,label])=>({value,label}));
  };
  assert.deepEqual(catalog('APPROVED_GLASS_OPTIONS').map(item=>item.label),[
    '3/8" Clear Glass','3/8" Low Iron Glass','3/8" Reeded Glass','3/8" Acid Etched Glass',
    '3/8" Low Iron Acid Etched Glass','1/2" Clear Glass','1/2" Low Iron Glass'
  ]);
  assert.deepEqual(catalog('APPROVED_MIRROR_OPTIONS').map(item=>item.label),[
    '1/4" Clear Mirror','1/4" Low Iron Mirror','1/4" Bronze Mirror','1/4" Grey Mirror'
  ]);
  assert.match(script,/Glass: APPROVED_GLASS_OPTIONS,\s*Mirror: APPROVED_MIRROR_OPTIONS/);
  assert.match(script,/glassTypeSelect\.value = ""/);
  assert.match(script,/mirrorFrameGroup\.hidden = selectedService !== 'Mirror'/);
  assert.match(script,/mirrorFrameSelect\.value = 'no'/);
  assert.match(script,/querySelector\('#enduro-shield-group'\)\.hidden = selectedService === 'Mirror'/);
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/id="mirror-frame-group"[^>]*hidden/);
  assert.match(html,/id="mirror-frame"[\s\S]*?value="no" selected/);
  assert.match(html,/Add Metal \/ Frame \(\+\$15 \/ sq ft\)/);
});

test('model choices describe physical layouts and leave material selection independent',()=>{
  const script=readFileSync(new URL('../script.js',import.meta.url),'utf8');
  const modelBlock=script.match(/const products = \[([\s\S]*?)\n\];/)?.[1];
  assert.ok(modelBlock,'shower model catalog exists');
  for(const label of ['Sliding Door','Not Sure / Let Bruno’s recommend it','Swing Door + Fixed Panel','90° Corner','Fixed Panel / Walk-In','Tub Enclosure']) assert.ok(modelBlock.includes(label),`missing physical model ${label}`);
  assert.doesNotMatch(modelBlock,/Regular Clear Glass|Low-Iron Glass|glass\s*:/i);
  assert.match(script,/glassTypeSelect\.value = ""/);
  assert.doesNotMatch(script,/glassTypeSelect\.value\s*=\s*product\.glass/);
  assert.match(script,/doorTypeSelect\.value = product\.doorType/);
  assert.match(script,/const model = products\.find\(\(item\) => item\.name === option\.value\)/);
  assert.match(script,/No preset physical model is configured for this service\. Continue to Options to select the material separately\./);
  assert.doesNotMatch(script,/moveField\(glassTypeGroup\)/);
  const serviceReset=script.slice(script.indexOf("serviceSelect.addEventListener('change'"),script.indexOf("productSelect.addEventListener('change'"));
  assert.match(serviceReset,/productSelect\.value = ""/);
  assert.match(serviceReset,/glassTypeSelect\.value = ""/);
  assert.match(serviceReset,/doorTypeSelect\.value = ""/);
  assert.match(serviceReset,/mirrorFrameSelect\.value = 'no'/);
  assert.match(serviceReset,/if \(selectedService === 'Mirror'\) document\.querySelector\('#enduro-shield'\)\.checked = false/);
  const requestProject=script.slice(script.indexOf('function currentPricingProject'),script.indexOf('async function requestEstimatedPrice'));
  assert.doesNotMatch(requestProject,/productSelect|doorType/,'Physical model selection does not affect the pricing request.');
  const catalogExpression=script.match(/const products = (\[[\s\S]*?\n\]);/)?.[1];
  const models=new Function(`return ${catalogExpression}`)();
  const handlerBody=script.match(/productSelect\.addEventListener\('change',\s*\(\) => \{([\s\S]*?)\n\}\);/)?.[1];
  assert.ok(handlerBody,'model selection handler exists');
  const glassTypeSelect={value:'Low-Iron Glass - 3/8'};
  let currentModel='';
  const doorTypeSelect={innerHTML:'',value:'',appendChild(option){this.option=option;this.value=option.value;}};
  const selectModel=new Function('productSelect','products','document','doorTypeSelect','updateProductGallery','updateProjectReference',handlerBody);
  for(const model of models){
    selectModel({value:model.name},models,{createElement:()=>({})},doorTypeSelect,product=>{currentModel=product.name;},()=>{});
    assert.equal(glassTypeSelect.value,'Low-Iron Glass - 3/8',`${model.name} leaves material selection unchanged`);
    assert.equal(doorTypeSelect.value,model.doorType);
    assert.equal(currentModel,model.name);
  }
  assert.equal(models.length,6);
  assert.equal(new Set(models.map(model=>model.image)).size,6,'Each layout has its own cropped reference photo.');
  for(const model of models) {
    assert.match(model.image,/^images\/reference\/shower-[a-z-]+\.jpg$/);
    assert.ok(readFileSync(new URL(`../${model.image}`,import.meta.url)).length>1000);
    assert.match(model.source,/Supplied reference board/);
  }
  assert.match(script,/Configuration reference only; it does not identify the glass material/);
  const references=readFileSync(new URL('../docs/model-configuration-references.md',import.meta.url),'utf8');
  for(const source of ['IGT pivot hinge reference','CRL corner-return technical sheet','CRL fixed-panel channel reference','CRL tub/shower enclosure reference']) assert.ok(references.includes(source),`missing terminology reference ${source}`);
});

test('Admin prefill uses the same confirmed rate keys and values as the central engine',()=>{
  const admin=readFileSync(new URL('../admin.js',import.meta.url),'utf8');
  const table=admin.match(/const sellingRateRows = \[([\s\S]*?)\n\];/);
  assert.ok(table,'Admin selling-rate rows exist');
  const rows=[...table[1].matchAll(/\['([^']+)','([^']+)',(\d+(?:\.\d+)?),'[^']+'\]/g)];
  const adminRates=Object.fromEntries(rows.map(([,material,,rate])=>[
    material.toLowerCase().replaceAll('"','').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''),Number(rate)
  ]));
  assert.deepEqual(adminRates,confirmedRates.finalSellingRates);
  assert.equal(adminRates['bronze-mirror-1-4'],75);
  assert.equal(adminRates['gray-mirror-1-4'],75);
  assert.equal(adminRates['clear-mirror-1-4'],45);
  assert.equal(adminRates['low-iron-mirror-1-4'],65);
  assert.equal(adminRates['metal-frame'],15);
  assert.equal(Object.hasOwn(adminRates,'clear-glass-1-4'),false);
  assert.equal(Object.hasOwn(adminRates,'low-iron-glass-1-4'),false);
});

test('Admin selling-price controls cannot fall back to native GET and require authenticated central pricing',()=>{
  const html=readFileSync(new URL('../admin.html',import.meta.url),'utf8');
  const admin=readFileSync(new URL('../admin.js',import.meta.url),'utf8');
  assert.match(html,/<form id="pricing-settings-form"/);
  assert.match(html,/<button[^>]*id="save-selling-prices"[^>]*type="button"/);
  assert.match(html,/<button[^>]*id="reload-pricing-settings"[^>]*type="button"/);
  assert.match(html,/<script src="admin\.js"><\/script>/);
  assert.match(admin,/querySelector\('#pricing-settings-form'\)/);
  assert.match(admin,/querySelector\('#save-selling-prices'\)/);
  assert.match(admin,/pricingForm\?\.addEventListener\('submit',\s*savePricingSettings\)/);
  const handler=admin.slice(admin.indexOf('async function savePricingSettings'),admin.indexOf('// Keep both explicit button clicks'));
  assert.match(handler,/event\?\.preventDefault\?\.\(\)/);
  assert.match(handler,/if \(!session\?\.access_token\)/);
  assert.match(handler,/Sign in to an authorized Admin account/);
  assert.match(handler,/callPricing\('save'/);
  assert.match(admin,/Authorization:`Bearer \$\{session\.access_token\}`/);
  assert.match(admin,/pricingForm\?\.addEventListener\('submit'/);
  assert.match(admin,/pricingForm\?\.addEventListener\('input'/);
  assert.match(admin,/callPricing\('read'\)/);
  assert.match(admin,/pricingDraft = pricing\?\.config\?\.pricingModel === 'selling-rates-v1'/);
  assert.match(admin,/pricingDraft = pricing\.config;/);
  assert.match(admin,/Central pricing \\u2014 Saved\. Revision/);
  assert.ok(admin.indexOf("pricingForm?.addEventListener('submit'") < admin.indexOf('supabaseClient.auth.getSession()\n    .then'));
});

test('OPTIONS succeeds before client initialization; errors and success retain CORS',async()=>{
  const origins=['http://127.0.0.1:8000','http://localhost:8000','http://127.0.0.1:8765','http://localhost:8765','https://brunos-glass-mirror.english-academy-fl.workers.dev'];
  let handler,initializations=0;
  let source=readFileSync(new URL('../supabase/functions/pricing/index.ts',import.meta.url),'utf8');
  source=source.replace(/^\uFEFF/,'').replace(/^import .*;\r?\n/gm,'');
  vm.runInNewContext(stripTypeScriptTypes(source),{createClient:()=>{initializations++;throw Error('Unavailable client');},createPricingHandler,
    Deno:{env:{get:()=>undefined},serve:fn=>{handler=fn;}}});
  for(const origin of origins){
    const response=await handler(new Request('https://local/functions/v1/pricing',{method:'OPTIONS',headers:{Origin:origin,
      'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'apikey,authorization,content-type'}}));
    assert.equal(response.status,204);assert.equal(response.headers.get('Access-Control-Allow-Origin'),origin);
    assert.match(response.headers.get('Access-Control-Allow-Methods'),/POST/);
    for(const h of ['apikey','authorization','content-type'])assert.ok(response.headers.get('Access-Control-Allow-Headers').includes(h));
  }
  assert.equal(initializations,0);
  const rejectedOrigin=await handler(new Request('https://local/functions/v1/pricing',{method:'OPTIONS',headers:{Origin:'https://brunos-glass-mirror.fittony85.workers.dev',
    'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'apikey,authorization,content-type'}}));
  assert.equal(rejectedOrigin.headers.get('Access-Control-Allow-Origin'),null);
  const origin=origins[0];
  const error=await handler(new Request('https://local/pricing',{method:'POST',headers:{Origin:origin},body:JSON.stringify({action:'estimate',project:shower})}));
  assert.equal(error.status,503);assert.equal(error.headers.get('Access-Control-Allow-Origin'),origin);
  const healthy=createPricingHandler({allowedOrigins:new Set(origins),read:async()=>({config:fixture(),revision:1}),save:async()=>null,requireAdmin:async()=>null});
  for(const [body,status] of [[{action:'estimate',project:shower},200],[{action:'save'},403],[{action:'unknown'},400]]){
    const response=await healthy(new Request('https://local/pricing',{method:'POST',headers:{Origin:origin},body:JSON.stringify(body)}));
    assert.equal(response.status,status);assert.equal(response.headers.get('Access-Control-Allow-Origin'),origin);
  }
});

test('production pricing auth checks verified app metadata or configured allowlist',async()=>{
  let handler;
  const users={admin:{id:'admin',app_metadata:{role:'admin'}},
    ordinary:{id:'ordinary',app_metadata:{},user_metadata:{role:'admin'}},
    allowed:{id:'allowed',app_metadata:{},email:'OWNER@example.com'}};
  const client={auth:{getUser:async token=>({data:{user:users[token]},error:users[token]?null:'invalid'})},
    from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:null,error:null})})})})};
  let source=readFileSync(new URL('../supabase/functions/pricing/index.ts',import.meta.url),'utf8');
  source=source.replace(/^\uFEFF/,'').replace(/^import .*;\r?\n/gm,'');
  vm.runInNewContext(stripTypeScriptTypes(source),{createClient:()=>client,createPricingHandler,
    Deno:{env:{get:key=>key==='SUPABASE_SECRET_KEYS'?'{}':key==='ADMIN_EMAILS'?'owner@example.com':'test'},serve:fn=>{handler=fn;}}});
  for(const [token,status] of [['invalid',403],['ordinary',403],['admin',200],['allowed',200]]) {
    const response=await handler(new Request('https://local/pricing',{method:'POST',headers:{authorization:`Bearer ${token}`},body:JSON.stringify({action:'read'})}));
    assert.equal(response.status,status);
  }
});

test('actual submit function overwrites forged prices, preserves uploads and rejects stale revision before insert',async()=>{
  let handler; const rows=[]; const record={config:confirmedRates,revision:3};
  const client={from(table){
    if(table==='quote_pricing_config')return{select:()=>({eq:()=>({maybeSingle:async()=>({data:record,error:null})})})};
    assert.equal(table,'quotes');
    return {insert(data){rows.push(...data);return{select:()=>({single:async()=>({data:{id:'quote-test',tracking_number:'BGM-2026-00001'},error:null})})};}};
  },storage:{from:()=>({createSignedUploadUrl:async path=>({data:{token:'signed-test'},error:null})})}};
  let source=readFileSync(new URL('../supabase/functions/submit-quote/index.ts',import.meta.url),'utf8');
  source=source.replace(/^\uFEFF/,'').replace(/^import .*;\r?\n/gm,'');
  const context=vm.createContext({createClient:()=>client,normalizeProject,publicEstimate,quoteEstimateFields,
    Deno:{env:{get:key=>key==='SUPABASE_SECRET_KEYS' ? JSON.stringify({default:'test-only-key'}) : 'test-only'},serve:fn=>{handler=fn;}},
    Request,Response,Headers,crypto,btoa,atob,TextEncoder,TextDecoder,console,URL});
  vm.runInContext(stripTypeScriptTypes(source),context);
  const call=(revision,project=shower,mirrorFrame=false)=>handler(new Request('https://local/submit-quote',{method:'POST',body:JSON.stringify({action:'create',
    quote:{service:project.service,glass_type:project.glassType,width:project.width,height:project.height,quantity:1,
      estimated_price:1,estimated_price_low:1,estimated_price_high:1,final_price:1,status:'Approved',square_feet:1},
    pricing:{revision,counts:project.counts,mirrorFrame},files:[{name:'photo.jpg',type:'image/jpeg',size:10}]})}));
  assert.equal((await call(2)).status,409);assert.equal(rows.length,0);
  const response=await call(3);assert.equal(response.status,200);
  const body=await response.json();assert.equal(body.uploads.length,1);assert.ok(body.finalizeToken);assert.equal(body.trackingNumber,'BGM-2026-00001');assert.match(body.accessCode,/^[A-Za-z0-9_-]{43}$/);assert.match(rows[0].tracking_token_hash,/^[a-f0-9]{64}$/);
  const result=publicEstimate(shower,record);
  assert.equal(rows[0].estimated_price_low,result.low);assert.equal(rows[0].estimated_price_high,result.high);
  assert.equal(rows[0].final_price,null);assert.equal(rows[0].status,'New');
  assert.equal(rows[0].square_feet,shower.width*shower.height/144);
  assert.equal((await call(3,mirror)).status,200);
  const mirrorResult=publicEstimate(mirror,record);
  assert.equal(rows[1].estimated_price_low,mirrorResult.low);
  assert.equal(rows[1].estimated_price_high,mirrorResult.high);
  assert.equal(rows[1].final_price,null);
  const framedMirror={...mirror,width:60,height:96};
  assert.equal((await call(3,framedMirror,true)).status,200);
  assert.equal(rows[2].estimated_price_low,2400);
  assert.equal(rows[2].estimated_price_high,2400);
});

test('custom quote submit skips automatic pricing and stores null estimates',()=>{
  const source=readFileSync(new URL('../supabase/functions/submit-quote/index.ts',import.meta.url),'utf8');
  assert.match(source,/body\.pricing\?\.customQuote === true/);
  assert.match(source,/estimated_price:null,estimated_price_low:null,estimated_price_high:null/);
  assert.match(source,/custom requests are stored without invented prices/);
});
