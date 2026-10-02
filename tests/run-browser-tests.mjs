// Local-only browser runner. All non-local requests are intercepted before navigation.
import {createServer} from 'node:http';
import {readFile, mkdtemp, access} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const localPort = Number(process.env.PRESENTATION_HTTP_PORT || 8766);
const localOrigin = `http://127.0.0.1:${localPort}`;
const root = fileURLToPath(new URL('../', import.meta.url));
const browserPaths = [process.env.TEST_BROWSER, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
let executable;
for (const path of browserPaths) { try { await access(path); executable = path; break; } catch {} }
if (!executable) throw Error('Set TEST_BROWSER to an installed Chromium browser executable.');
const server = createServer(async (request, response) => {
  try {
      const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const path = resolve(root, '.' + (name === '/' ? '/index.html' : name));
    if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) throw Error('Invalid path');
    const types = {'.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.jpeg':'image/jpeg', '.jpg':'image/jpeg', '.webp':'image/webp'};
    response.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream');
    response.end(await readFile(path));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise((done, fail) => server.once('error', fail).listen(localPort, '127.0.0.1', done));
const profile = await mkdtemp(resolve(tmpdir(), 'bruno-configurator-'));
const port = Number(process.env.PRESENTATION_CDP_PORT || 9444);
const browser = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], {windowsHide:true, stdio:'ignore'});
let socket;
try {
  let targets;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (targets.some(item => item.type === 'page')) break; } catch {}
    await new Promise(done => setTimeout(done, 100));
  }
  const target = targets?.find(item => item.type === 'page');
  if (!target) throw Error('Browser debugging endpoint did not start.');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, fail) => { socket.addEventListener('open', done, {once:true}); socket.addEventListener('error', fail, {once:true}); });
  let sequence = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((done, fail) => {
    const id = ++sequence; pending.set(id, {done, fail}); socket.send(JSON.stringify({id, method, params}));
  });
  const blocked = [];
  socket.addEventListener('message', async event => {
    const message = JSON.parse(event.data);
    if (message.id) { const entry = pending.get(message.id); pending.delete(message.id); message.error ? entry?.fail(Error(message.error.message)) : entry?.done(message.result); }
    if (message.method !== 'Fetch.requestPaused') return;
    const {requestId, request} = message.params;
    if (request.url.startsWith(localOrigin + '/')) return send('Fetch.continueRequest', {requestId});
    let body = '', type = 'text/plain';
    if(request.url.includes('.supabase.co/')&&request.method==='OPTIONS') {
      return send('Fetch.fulfillRequest',{requestId,responseCode:204,responseHeaders:[{name:'Access-Control-Allow-Origin',value:'*'},{name:'Access-Control-Allow-Methods',value:'POST, OPTIONS'},{name:'Access-Control-Allow-Headers',value:'authorization, apikey, content-type, x-client-info'}],body:''});
    }
    if (request.url.includes('cdn.jsdelivr.net/npm/@supabase/supabase-js')) {
      type = 'text/javascript';
      body = `window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({}),signOut:async()=>({})},storage:{from:()=>({uploadToSignedUrl:async(path,token,file)=>{(window.__uploads ||= []).push({path,name:file.name});return {error:null}}})}})};`;
    } else if (request.url.includes('.supabase.co/')) {
      blocked.push(request.url);
      type = 'application/json';
      if (request.url.includes('/functions/v1/analyze-photo')) {
        type='application/json';
        body=JSON.stringify({category:'shower_glass',confidence:0.86,reasoning:'Synthetic test fixture only; not an analysis of a customer image.',geometry:'straight_tub_alcove',geometryConfidence:0.91,geometryReasoning:'Synthetic test fixture: a straight bathtub alcove.',openingBox:{x:0.2,y:0.18,width:0.6,height:0.68},measurement:{widthInches:60,heightInches:72,confidence:0.84,basis:'Synthetic test measurement using a standard bathtub reference.',referenceSuggestion:''},recommendations:[{configuration:'Sliding Door',reason:'Synthetic compatible option.'},{configuration:'Tub Enclosure',reason:'Synthetic best match.'},{configuration:'90° Corner',reason:'Incompatible fixture item to prove filtering.'}]});
      } else body = JSON.stringify({estimate:{complete:false,reason:'pricing_unavailable',revision:0}});
    }
    await send('Fetch.fulfillRequest', {requestId, responseCode:200, responseHeaders:[{name:'Content-Type',value:type},{name:'Access-Control-Allow-Origin',value:'*'}], body:Buffer.from(body).toString('base64')});
  });
  await send('Fetch.enable', {patterns:[{urlPattern:'*'}]});
  const presentationUrl = localOrigin + '/index.html?ref=jeff';
  await send('Page.navigate', {url:presentationUrl});
  let pageReady = false;
  let currentPages = [];
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      currentPages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      pageReady = currentPages.some(item => item.type === 'page' && item.url.startsWith(localOrigin + '/index.html'));
      if (pageReady) break;
    } catch {}
    await new Promise(done => setTimeout(done, 50));
  }
  if (!pageReady) throw Error(`Presentation page did not navigate to ${presentationUrl}.`);
  const child = spawn(process.execPath, ['tests/browser-presentation-smoke.mjs'], {cwd:root, windowsHide:true, stdio:'inherit'});
  const timeout = setTimeout(() => child.kill(), 90000);
  const result = await new Promise(done => child.once('exit', done));
  clearTimeout(timeout);
  if (result !== 0) throw Error(`Browser tests failed (exit ${result}).`);
  console.log(`Network isolation: ${blocked.length} Supabase requests intercepted; no production traffic sent.`);
  await send('Browser.close');
} finally {
  socket?.close(); browser.kill(); server.close();
}
