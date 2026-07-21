// Bundle + run the headless SVB sanity check (see svb-sanity-src.mts).
// Usage: node scripts/svb-sanity.mjs [visits]
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';

const out = 'node_modules/.cache/svb-sanity.mjs';
await build({
  entryPoints: ['scripts/svb-sanity-src.mts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outfile: out,
  logLevel: 'warning',
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});

const res = spawnSync('node', [out], {
  stdio: 'inherit',
  env: { ...process.env, SVB_VISITS: process.argv[2] ?? '250' },
});
process.exit(res.status ?? 1);
