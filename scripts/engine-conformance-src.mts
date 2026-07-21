// Browser-engine leg of the engine-conformance harness (see the tools repo:
// evaluation/engine-conformance/conformance.py). Runs the app's real
// MctsSearch headless on the pinned positions with b6 and prints one JSON
// line of normalized results. Args via env: CONF_VISITS, CONF_QUICK.
import * as tf from '@tensorflow/tfjs';
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { parseKataGoModelV8 } from '../src/katago/engine/katago/loadModelV8';
import { KataGoModelV8Tf } from '../src/katago/engine/katago/modelV8';
import { MctsSearch } from '../src/katago/engine/katago/analyzeMcts';
import type { BoardState, Move } from '../src/katago/types';

const MODEL_PATH = `${process.env.HOME}/pwsiegel/KataGo/models/g170-b6c96.bin.gz`;
const POSITIONS_PATH = `${process.env.HOME}/pwsiegel/go-app/evaluation/engine-conformance/positions.json`;
const VISITS = Number(process.env.CONF_VISITS ?? 800);
const QUICK = process.env.CONF_QUICK === '1';

const COLS = 'ABCDEFGHJKLMNOPQRST';

async function main() {
  try {
    const wasm = await import('@tensorflow/tfjs-backend-wasm');
    wasm.setWasmPaths(`${process.cwd()}/node_modules/@tensorflow/tfjs-backend-wasm/dist/`);
    await tf.setBackend('wasm');
  } catch {
    await tf.setBackend('cpu');
  }
  await tf.ready();
  console.error(`backend: ${tf.getBackend()}`);

  const raw = readFileSync(MODEL_PATH);
  const data = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw;
  const model = new KataGoModelV8Tf(parseKataGoModelV8(new Uint8Array(data)));

  let positions: Array<{ id: string; moves: Array<[string, string]> }> =
    JSON.parse(readFileSync(POSITIONS_PATH, 'utf8'));
  if (QUICK) positions = positions.slice(0, 3);

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
    const toPlay = pos.moves.length % 2 === 0 ? 'black' : 'white';

    const t0 = Date.now();
    const search = await MctsSearch.create({
      model,
      board,
      currentPlayer: toPlay,
      moveHistory: history,
      komi: 7.5,
      rules: 'chinese',
      nnRandomize: false,
      conservativePass: true,
      maxChildren: 32,
      ownershipMode: 'root',
      wideRootNoise: 0.04,
      rootSymmetrySamples: 1,
    });
    await search.run({ visits: VISITS, maxTimeMs: 890_000, batchSize: 8 });
    const a = search.getAnalysis({ topK: 30, analysisPvLen: 1, cloneBuffers: true });
    console.error(`${pos.id}: ${a.rootVisits}v in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    out.push({
      root_lead: a.rootScoreLead,
      root_winrate: a.rootWinRate,
      root_visits: a.rootVisits,
      ownership: a.ownership && a.ownership.length === 361,
      moves: a.moves.map((m) => ({
        move: `${COLS[m.x]}${19 - m.y}`,
        visits: m.visits,
        lead: m.scoreLead,
      })),
    });
  }
  console.log(JSON.stringify(out));
}

main().catch((e) => { console.error(e); process.exit(1); });
