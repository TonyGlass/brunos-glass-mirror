// Calls only the isolated staging analyze-photo function. Never prints keys or image data.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const ref='ohtcuocrxfidpwypxvwv';
const validated=!process.argv.includes('--images-only');
const runtime=await readFile(new URL('../.staging-dist/runtime-config.js',import.meta.url),'utf8');
const url=runtime.match(/supabaseUrl:'(https:\/\/[^']+)'/)?.[1];
const key=runtime.match(/supabasePublishableKey:'([^']+)'/)?.[1];
assert.equal(new URL(url).hostname,`${ref}.supabase.co`,'Must use staging Supabase only.');
assert.ok(key?.startsWith('sb_publishable_'),'Staging publishable key is required.');
const endpoint=`${url}/functions/v1/analyze-photo`;
const origin='https://brunos-glass-mirror-staging.english-academy-fl.workers.dev';
const headers={apikey:key,authorization:`Bearer ${key}`,'content-type':'application/json',origin};

if(!process.argv.includes('--images-only')){
  const options=await fetch(endpoint,{method:'OPTIONS',headers:{origin,'access-control-request-method':'POST','access-control-request-headers':'authorization, apikey, content-type'}});
  assert.equal(options.status,204,'Staging browser preflight should succeed.');
  assert.equal(options.headers.get('access-control-allow-origin'),origin,'Staging origin must be explicitly allowed.');
  const badMime=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({image:'data:image/heic;base64,AA=='})});
  assert.equal(badMime.status,400,'HEIC should be rejected with a clear manual fallback.');
  assert.match((await badMime.json()).error,/JPG, PNG or WebP/);
  const oversized=Buffer.alloc(8*1024*1024+1).toString('base64');
  const largeResponse=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({image:`data:image/jpeg;base64,${oversized}`})});
  assert.equal(largeResponse.status,400,'An image over 8 MiB should be rejected before calling OpenAI.');
  assert.match((await largeResponse.json()).error,/up to 8 MB/);
  // The endpoint's public-request limiter is five calls per minute per isolate.
  await new Promise(resolve=>setTimeout(resolve,61_000));
}
const cases=[
  ['shower_glass','shower-sliding.jpg'],
  ['shower_glass','shower-tub.jpg'],
  ['shower_glass','shower-corner.jpg'],
  ['mirror','mirror-custom.jpg'],
  ['mirror','mirror-wall.jpg'],
  ['architectural_glass','glass-partitions.jpg'],
  ['unclear','../brunos-glass-mirror-logo.png']
];
const results=[];
for(const [index,[expected,file]] of cases.entries()){
  if(index===4)await new Promise(resolve=>setTimeout(resolve,61_000));
  const imagePath=file.startsWith('../')?new URL(`../images/${file.slice(3)}`,import.meta.url):new URL(`../images/reference/${file}`,import.meta.url);
  const bytes=await readFile(imagePath);
  const image=`data:image/${file.endsWith('.png')?'png':'jpeg'};base64,${bytes.toString('base64')}`;
  const response=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({image})});
  const payload=await response.json();
  assert.equal(response.status,200,`Real ${expected} request failed: ${JSON.stringify({error:payload.error,providerStatus:payload.providerStatus,providerErrorType:payload.providerErrorType,providerErrorCode:payload.providerErrorCode,status:response.status})}`);
  assert.ok(typeof payload.model==='string'&&payload.model.length>0,'Backend should report the actual OpenAI response model.');
  assert.equal(payload.category,expected,`Expected ${expected} from ${file}, received ${payload.category}.`);
  assert.ok(!('width' in payload)&&!('height' in payload)&&!('dimensions' in payload),'Vision result must use the explicit preliminary measurement record.');
  assert.ok(payload.measurement&&Object.hasOwn(payload.measurement,'widthInches')&&Object.hasOwn(payload.measurement,'heightInches'),'Every image returns an explicit measurement decision.');
  const hasWidth=Number.isFinite(payload.measurement.widthInches),hasHeight=Number.isFinite(payload.measurement.heightInches);
  assert.equal(hasWidth,hasHeight,'AI dimensions are returned as a Width/Height pair or neither.');
  if(hasWidth){
    assert.ok(payload.measurement.widthInches>=12&&payload.measurement.widthInches<=240&&payload.measurement.heightInches>=12&&payload.measurement.heightInches<=240,'Approximate dimensions stay inside supported bounds.');
    assert.ok(payload.measurement.confidence>=.75&&payload.measurement.basis.length>=12,'Numerical estimates require a reliable scale cue and confidence threshold.');
  }else if(expected!=='unclear'){
    assert.ok(payload.measurement.confidence<.75,'A no-dimension result must explain low confidence.');
    assert.ok(payload.measurement.referenceSuggestion.length>0,'Low confidence must ask for one useful photo or known-size reference.');
  }
  if(expected==='shower_glass'){
    assert.ok(payload.recommendations.length>0,'Shower photo should receive a configuration recommendation.');
    const allowedByGeometry={straight_tub_alcove:['Tub Enclosure','Sliding Door'],straight_shower_opening:['Sliding Door','Swing Door + Fixed Panel','Fixed Panel / Walk-In'],corner_90:['90° Corner'],neo_angle:['Not Sure / Let Bruno’s recommend it'],unclear:['Not Sure / Let Bruno’s recommend it']};
    const expectedFamily=allowedByGeometry[payload.geometry];
    assert.ok(expectedFamily,'Analyzer must return a supported geometry classification.');
    assert.deepEqual(payload.recommendations.map(item=>item.configuration),expectedFamily,`Recommendations must match the filtered catalog family for ${payload.geometry}.`);
    if(payload.geometry==='straight_tub_alcove')assert.ok(!payload.recommendations.some(item=>['90° Corner','Swing Door + Fixed Panel','Fixed Panel / Walk-In'].includes(item.configuration)),'Straight tub must exclude corner, hinged-panel and walk-in configurations.');
  }else assert.deepEqual(payload.recommendations,[],'Only shower photos should receive shower configuration recommendations.');
  results.push({expected,file,model:payload.model,category:payload.category,confidence:payload.confidence,reasoning:payload.reasoning,openingBox:payload.openingBox,measurement:payload.measurement,recommendations:payload.recommendations,tokenUsage:payload.usage});
}
console.log(JSON.stringify({staging:true,preflight:validated?'pass':'not-run-this-invocation',unsupportedHEIC:validated?'400 manual fallback':'not-run-this-invocation',oversize:validated?'400 before provider call':'not-run-this-invocation',realOpenAIRequests:results},null,2));
