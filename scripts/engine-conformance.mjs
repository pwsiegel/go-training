// Bundle + run the browser-engine conformance leg (engine-conformance-src.mts).
// Usage: node scripts/engine-conformance.mjs [visits] [quick01]
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';

const out = 'node_modules/.cache/engine-conformance.mjs';
await build({
  entryPoints: ['scripts/engine-conformance-src.mts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outfile: out,
  logLevel: 'warning',
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});

const res = spawnSync('node', [out], {
  stdio: ['inherit', 'inherit', 'inherit'],
  env: {
    ...process.env,
    CONF_VISITS: process.argv[2] ?? '800',
    CONF_QUICK: process.argv[3] ?? '0',
  },
});
process.exit(res.status ?? 1);
