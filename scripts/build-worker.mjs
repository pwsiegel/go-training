// Pre-bundle the KataGo tfjs worker into a single self-contained file.
//
// Vite dev serves modules as raw ESM, which the tfjs worker doesn't survive;
// the production build bundles it via Rollup, which works. This produces that
// same bundled worker up front so BOTH dev and prod load one static file
// (public/katago-worker.js) — the engine runs identically in either.
//
// Also stages the tfjs-wasm binaries the worker's WASM fallback expects.

import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';

const base = process.env.VITE_BASE || '/';

mkdirSync('public/tfjs', { recursive: true });
for (const f of [
  'tfjs-backend-wasm.wasm',
  'tfjs-backend-wasm-simd.wasm',
  'tfjs-backend-wasm-threaded-simd.wasm',
]) {
  cpSync(`node_modules/@tensorflow/tfjs-backend-wasm/dist/${f}`, `public/tfjs/${f}`);
}

await build({
  entryPoints: ['src/katago/engine/katago/worker.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outfile: 'public/katago-worker.js',
  // The worker reads import.meta.env.BASE_URL (via publicUrl) for the wasm path.
  define: { 'import.meta.env': JSON.stringify({ BASE_URL: base }) },
  logLevel: 'info',
});

console.log(`built public/katago-worker.js (base=${base})`);
