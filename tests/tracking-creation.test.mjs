import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

function setup({uploadFails = false, secret = 'local-only-secret'} = {}) {
  let handler;
  const rows=[];
  const client={from(table){
    assert.equal(table,'quotes');
    return {insert(data){
      const row={...data[0],id:`local-${rows.length+1}`,tracking_number:`BGM-2026-${String(rows.length+1).padStart(5,'0')}`};rows.push(row);
      return {select:()=>({single:async()=>({data:row,error:null})})};
    },select(){
      const filters={};const query={eq(key,value){filters[key]=value;return query},async maybeSingle(){return {data:rows.find(row=>Object.entries(filters).every(([key,value])=>row[key]===value)) || null,error:null}}};return query;
    }};
  },storage:{from:()=>({createSignedUploadUrl:async()=>uploadFails ? {data:null,error:Error('local upload unavailable')} : {data:{token:'local-only-upload'},error:null}})}};
  const source=readFileSync(new URL('../supabase/functions/submit-quote/index.ts',import.meta.url),'utf8').replace(/^\uFEFF/,'').replace(/^import .*;\r?\n/gm,'');
  vm.runInNewContext(stripTypeScriptTypes(source),{createClient:()=>client,
    Deno:{env:{get:key=>key==='SUPABASE_SECRET_KEYS' ? '{"default":"local"}' : key==='QUOTE_UPLOAD_TOKEN_SECRET' ? secret : 'local'},serve:fn=>{handler=fn}},
    Request,Response,Headers,crypto,btoa,atob,TextEncoder,console});
  const call=body=>handler(new Request('https://local/submit-quote',{method:'POST',body:JSON.stringify(body)}));
  const create=()=>call({action:'create',pricing:{customQuote:true},quote:{service:'Glass',product:'Glass Door',width:60,height:72,customer_confirmed_width:60,customer_confirmed_height:72,measurement_source:'customer_manual',tracking_number:'FORGED',tracking_token_hash:'FORGED',name:'Private Name',email:'private@example.com'},files:[{name:'opening.png',size:20,type:'image/png'}]});
  return {rows,call,create};
}

test('actual creation returns backend order/code, stores only the code hash, and rejects client tracking fields',async()=>{
  const {create,rows}=setup();
  const first=await (await create()).json();const second=await (await create()).json();
  assert.equal(first.trackingNumber,rows[0].tracking_number);
  assert.notEqual(first.trackingNumber,'FORGED'); assert.notEqual(first.trackingNumber,second.trackingNumber);
  assert.notEqual(first.accessCode,second.accessCode);
  const hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(first.accessCode))).toString('hex');
  assert.equal(rows[0].tracking_token_hash,hash);
  assert.doesNotMatch(JSON.stringify(rows),new RegExp(first.accessCode));
  assert.equal(first.tracking_token_hash,undefined);
});

test('upload preparation failure preserves created order credentials; missing signing secret prevents insertion',async()=>{
  const partial=setup({uploadFails:true});const response=await partial.create();const body=await response.json();
  assert.equal(response.status,201); assert.equal(partial.rows.length,1);
  assert.equal(body.trackingNumber,partial.rows[0].tracking_number);assert.match(body.accessCode,/^[A-Za-z0-9_-]{43}$/);
  assert.match(body.uploadPreparationError,/Request received/);assert.equal(body.finalizeToken,null);
  const unavailable=setup({secret:null});assert.equal((await unavailable.create()).status,503);assert.equal(unavailable.rows.length,0);
});

test('actual public tracking requires both credentials and gates unpublished Final Quote and private customer data',async()=>{
  const {call,create,rows}=setup();const credentials=await (await create()).json();
  Object.assign(rows[0],{final_quote_draft_price:9999,final_price:2400,technician_notes:'Internal note',project_status:'Fabrication'});
  assert.equal((await call({action:'track',orderNumber:credentials.trackingNumber,accessCode:'x'.repeat(43)})).status,404);
  const response=await call({action:'track',orderNumber:credentials.trackingNumber,accessCode:credentials.accessCode});
  assert.equal(response.status,200);const body=await response.json();
  assert.equal(body.project.finalQuote.status,'Not published');
  assert.doesNotMatch(JSON.stringify(body),/Private Name|private@example|Internal note|tracking_token_hash|9999|2400/);
  rows[0].final_quote_sent_at='2026-09-30T12:00:00Z';
  const published=await (await call({action:'track',orderNumber:credentials.trackingNumber,accessCode:credentials.accessCode})).json();
  assert.equal(published.project.finalQuote.price,2400);
});
