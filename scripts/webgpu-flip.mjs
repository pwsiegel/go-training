// Drive the WebGPU flip-position validation in headless Chrome: bundle the
// page script, serve it + the b18 net + the flip positions locally, launch
// Chrome (--enable-unsafe-webgpu), collect POSTed results, print, exit.
// Usage: node scripts/webgpu-flip.mjs
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { glob } from 'node:fs/promises';

const CACHE = 'node_modules/.cache/webgpu-flip';
mkdirSync(CACHE, { recursive: true });

await build({
  entryPoints: ['scripts/webgpu-flip-src.mts'],
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  outfile: `${CACHE}/page.js`,
  logLevel: 'warning',
});
writeFileSync(`${CACHE}/index.html`, '<!doctype html><body><script type="module" src="/page.js"></script></body>');

let modelPath = null;
for await (const p of glob(`${process.env.HOME}/pwsiegel/KataGo/models/kata1-b18c384nbt-*.bin.gz`)) modelPath = p;

// The three ablation positions with known signatures (see lab notebook
// 2026-07-21): 07b/08k are SVB-attributable flips, 12b is graph-search-
// attributable (expected to still miss).
const all = JSON.parse(readFileSync(`${process.env.HOME}/pwsiegel/go-app/evaluation/engine-conformance/positions.json`, 'utf8'));
const wanted = (process.env.FLIP_IDS ?? '2015-01-07b@107,2015-01-08k@128,2015-01-12b@121').split(',');
const positions = all.filter((p) => wanted.includes(p.id));
if (positions.length !== wanted.length) throw new Error('positions missing from suite');

const files = {
  '/': { body: readFileSync(`${CACHE}/index.html`), type: 'text/html' },
  '/page.js': { body: readFileSync(`${CACHE}/page.js`), type: 'text/javascript' },
  '/model.bin.gz': { body: readFileSync(modelPath), type: 'application/octet-stream' },
  '/positions.json': { body: JSON.stringify(positions), type: 'application/json' },
};

let finish;
const finished = new Promise((r) => { finish = r; });
const server = createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/result') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.end('ok');
      const msg = JSON.parse(body);
      if (msg.log) console.error(`[page] ${msg.log}`);
      if (msg.progress) console.error(`[page] ${msg.progress.id}: ${msg.progress.visits}v in ${msg.progress.secs}s -> ${msg.progress.top[0].move}`);
      if (msg.error) { console.error(`[page] ERROR ${msg.error}`); finish({ error: msg.error }); }
      if (msg.done) finish({ done: msg.done });
    });
    return;
  }
  const f = files[req.url];
  if (!f) { res.statusCode = 404; res.end(); return; }
  res.setHeader('content-type', f.type);
  res.end(f.body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
console.error(`serving on :${port}`);

const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new',
  '--enable-unsafe-webgpu',
  '--enable-features=Vulkan,WebGPU',
  '--no-first-run',
  '--disable-gpu-sandbox',
  `--user-data-dir=${CACHE}/profile`,
  `http://127.0.0.1:${port}/`,
], { stdio: 'ignore' });

const timeout = setTimeout(() => finish({ error: 'timeout (12 min)' }), 12 * 60 * 1000);
const result = await finished;
clearTimeout(timeout);
chrome.kill();
server.close();

if (result.error) {
  console.error(`FAILED: ${result.error}`);
  process.exit(1);
}
console.log(JSON.stringify(result.done, null, 1));
