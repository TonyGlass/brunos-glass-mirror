// Compare the deployed staging frontend with the local staging asset directory.
// Reports hashes/equality only; runtime-config contents and keys are never printed.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const origin='https://brunos-glass-mirror-staging.english-academy-fl.workers.dev';
const files=['index.html','script.js','quote-app.js','quote-experience.css','style.css','runtime-config.js'];
const result=[];
for(const file of files){
  const response=await fetch(`${origin}/${file}`,{signal:AbortSignal.timeout(15000),cache:'no-store'});
  assert.equal(response.status,200,`Staging asset ${file} returned HTTP ${response.status}.`);
  const remote=Buffer.from(await response.arrayBuffer());
  const local=await readFile(new URL(`../.staging-dist/${file}`,import.meta.url));
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  result.push({file,status:response.status,matchesLocal:hash(remote)===hash(local)});
}
const runtime=await readFile(new URL('../.staging-dist/runtime-config.js',import.meta.url),'utf8');
assert.match(runtime,/https:\/\/ohtcuocrxfidpwypxvwv\.supabase\.co/,'Local staging assets must target the isolated Supabase project.');
console.log(JSON.stringify({stagingOrigin:origin,assets:result},null,2));
