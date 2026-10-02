// Read-only check of the isolated staging pricing function. Never prints keys.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const stagingRef='ohtcuocrxfidpwypxvwv';
const origin='https://brunos-glass-mirror-staging.english-academy-fl.workers.dev';
const runtime=await readFile(new URL('../.staging-dist/runtime-config.js',import.meta.url),'utf8');
const supabaseUrl=runtime.match(/supabaseUrl:'(https:\/\/[^']+)'/)?.[1];
const publishableKey=runtime.match(/supabasePublishableKey:'([^']+)'/)?.[1];
assert.equal(new URL(supabaseUrl).hostname,`${stagingRef}.supabase.co`,'Refusing to contact a non-staging Supabase project.');
assert.ok(publishableKey?.startsWith('sb_publishable_'),'Staging publishable key is missing.');
const endpoint=`${supabaseUrl}/functions/v1/pricing`;
const headers={origin,apikey:publishableKey,authorization:`Bearer ${publishableKey}`,'content-type':'application/json'};

try {
  const preflight=await fetch(endpoint,{method:'OPTIONS',signal:AbortSignal.timeout(15000),headers:{
    origin,'access-control-request-method':'POST','access-control-request-headers':'apikey,authorization,content-type'
  }});
  console.log(JSON.stringify({request:'pricing CORS preflight',endpoint,status:preflight.status,
    allowOrigin:preflight.headers.get('access-control-allow-origin'),
    allowMethods:preflight.headers.get('access-control-allow-methods'),
    allowHeaders:preflight.headers.get('access-control-allow-headers')}));

  const preflightAllowed=preflight.status===204&&preflight.headers.get('access-control-allow-origin')===origin;
  const failures=[];
  const projects=[
    {service:'Shower Doors',glassType:'Low-Iron Glass - 3/8',width:60,height:72,quantity:1,counts:{splitLites:0,hinges:0,handles:0,clips:0,sweeps:0,channels:0,accessories:0},enduroShield:false,mirrorFrame:false},
    {service:'Mirror',glassType:'Clear Mirror - 1/4',width:60,height:96,quantity:1,counts:{},enduroShield:false,mirrorFrame:false}
  ];
  for(const project of projects){
    const response=await fetch(endpoint,{method:'POST',headers,signal:AbortSignal.timeout(15000),body:JSON.stringify({action:'estimate',project})});
    let payload;
    try {payload=await response.json();} catch {payload={error:'Response was not valid JSON.'};}
    const estimate=payload?.estimate;
    const expectedRangeHigh=estimate?.complete&&Number.isFinite(estimate.baseLow)
      ?Math.round((estimate.baseLow*1.1+Number.EPSILON)*100)/100:null;
    const responseShapeMatchesClient=Number.isSafeInteger(estimate?.revision)&&Number.isFinite(estimate?.baseLow)&&Number.isFinite(estimate?.baseHigh);
    const rangeMatchesApprovedContract=expectedRangeHigh!==null&&estimate.high===expectedRangeHigh;
    console.log(JSON.stringify({request:'public staging estimate',project:project.service,endpoint,status:response.status,
      allowOrigin:response.headers.get('access-control-allow-origin'),body:estimate?{estimate}:{error:payload?.error||'No public estimate returned.'},
      expectedRangeHigh,responseShapeMatchesClient,rangeMatchesApprovedContract}));
    if(response.status!==200||!estimate?.complete||!responseShapeMatchesClient||!rangeMatchesApprovedContract) {
      failures.push({project:project.service,status:response.status,complete:estimate?.complete,responseShapeMatchesClient,rangeMatchesApprovedContract});
    }
  }
  assert.equal(preflightAllowed,true,'The staging Worker origin must pass CORS preflight.');
  assert.deepEqual(failures,[],'Staging pricing must return the current frontend schema and approved range formula.');
} catch(error) {
  if(error instanceof TypeError || error.name==='TimeoutError') {
    console.error(JSON.stringify({endpoint,origin,networkError:error.name,message:error.message}));
  }
  throw error;
}
