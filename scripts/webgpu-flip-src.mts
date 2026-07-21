// Browser-side flip-position validation: runs the app's real MctsSearch on
// WebGPU (b18) against the SVB ablation positions and POSTs results back to
// the harness server. Driven by scripts/webgpu-flip.mjs in headless Chrome.
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-webgpu';
import { parseKataGoModelV8 } from '../src/katago/engine/katago/loadModelV8';
import { KataGoModelV8Tf } from '../src/katago/engine/katago/modelV8';
import { MctsSearch } from '../src/katago/engine/katago/analyzeMcts';
import type { BoardState, Move } from '../src/katago/types';

const COLS = 'ABCDEFGHJKLMNOPQRST';
const VISITS = 5000;

declare global {
  interface Window { pako?: unknown }
}

async function report(obj: unknown) {
  await fetch('/result', { method: 'POST', body: JSON.stringify(obj) });
}

async function main() {
  await tf.setBackend('webgpu');
  await tf.ready();
  await report({ log: `backend=${tf.getBackend()}` });

  const res = await fetch('/model.bin.gz');
  const raw = new Uint8Array(await res.arrayBuffer());
  // Server serves the gz; DecompressionStream handles it in-page.
  const ds = new Response(
    new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip')),
  );
  const data = new Uint8Array(await ds.arrayBuffer());
  const model = new KataGoModelV8Tf(parseKataGoModelV8(data));
  await report({ log: 'model loaded' });

  const positions: Array<{ id: string; moves: Array<[string, string]> }> =
    await (await fetch('/positions.json')).json();

  const out = [];
  for (const pos of positions) {
    const board: BoardState = Array.from({ length: 19 }, () => Array.from({ length: 19 }, () => null));
    const history: Move[] = [];
    for (const [c, g] of pos.moves) {
      const x = COLS.indexOf(g[0]!);
      const y = 19 - Number(g.slice(1));
      board[y]![x] = c === 'B' ? 'black' : 'white';
      history.push({ x, y, player: c === 'B' ? 'black' : 'white' });
    }
    const t0 = performance.now();
    const search = await MctsSearch.create({
      model,
      board,
      currentPlayer: pos.moves.length % 2 === 0 ? 'black' : 'white',
      moveHistory: history,
      komi: 7.5,
      rules: 'chinese',
      nnRandomize: true,
      conservativePass: true,
      maxChildren: 32,
      ownershipMode: 'root',
      wideRootNoise: 0.04,
    });
    await search.run({ visits: VISITS, maxTimeMs: 290_000, batchSize: 16 });
    const a = search.getAnalysis({ topK: 8, analysisPvLen: 1, cloneBuffers: true });
    const secs = (performance.now() - t0) / 1000;
    const entry = {
      id: pos.id,
      visits: a.rootVisits,
      secs: Math.round(secs),
      rootLead: Math.round(a.rootScoreLead * 100) / 100,
      top: a.moves.slice(0, 5).map((m) => ({
        move: `${COLS[m.x]}${19 - m.y}`, visits: m.visits,
        lead: Math.round(m.scoreLead * 100) / 100,
      })),
    };
    out.push(entry);
    await report({ progress: entry });
  }
  await report({ done: out });
}

main().catch((e) => report({ error: String(e && (e as Error).stack || e) }));
