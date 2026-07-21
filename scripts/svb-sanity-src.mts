// Headless sanity check for the SVB + recompute-backup port: run the real
// MctsSearch on the CPU backend with the small b6 net and assert basic
// invariants (search completes, finite values, SVB table populated).
// Bundled by scripts/svb-sanity.mjs; not part of the app build.
import * as tf from '@tensorflow/tfjs';
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { parseKataGoModelV8 } from '../src/katago/engine/katago/loadModelV8';
import { KataGoModelV8Tf } from '../src/katago/engine/katago/modelV8';
import { MctsSearch } from '../src/katago/engine/katago/analyzeMcts';
import type { BoardState, Move } from '../src/katago/types';

const MODEL_PATH = `${process.env.HOME}/pwsiegel/KataGo/models/g170-b6c96.bin.gz`;
const VISITS = Number(process.env.SVB_VISITS ?? 250);

// A sharp midgame-ish position: cross-cut fight in the center-right.
const MOVES_GTP: Array<[string, string]> = [
  ['B', 'Q16'], ['W', 'D4'], ['B', 'Q4'], ['W', 'D16'], ['B', 'R10'],
  ['W', 'N16'], ['B', 'P14'], ['W', 'N14'], ['B', 'O15'], ['W', 'N15'],
  ['B', 'O16'], ['W', 'O14'], ['B', 'P15'], ['W', 'P13'], ['B', 'N17'],
  ['W', 'M17'], ['B', 'O17'], ['W', 'L16'], ['B', 'Q12'], ['W', 'P12'],
  ['B', 'Q13'], ['W', 'O11'],
];

const COLS = 'ABCDEFGHJKLMNOPQRST';
function gtpToXy(s: string): { x: number; y: number } {
  const x = COLS.indexOf(s[0]!);
  const y = 19 - Number(s.slice(1));
  return { x, y };
}

async function main() {
  await tf.setBackend('cpu');
  await tf.ready();

  const raw = readFileSync(MODEL_PATH);
  const data = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw;
  const parsed = parseKataGoModelV8(new Uint8Array(data));
  const model = new KataGoModelV8Tf(parsed);
  console.log(`model: ${parsed.modelName}, backend: ${tf.getBackend()}`);

  const board: BoardState = Array.from({ length: 19 }, () => Array.from({ length: 19 }, () => null));
  const history: Move[] = [];
  for (const [c, g] of MOVES_GTP) {
    const { x, y } = gtpToXy(g);
    board[y]![x] = c === 'B' ? 'black' : 'white';
    history.push({ x, y, player: c === 'B' ? 'black' : 'white' });
  }

  const t0 = Date.now();
  const search = await MctsSearch.create({
    model,
    board,
    currentPlayer: 'black',
    moveHistory: history,
    komi: 7.5,
    rules: 'chinese',
    nnRandomize: false,
    conservativePass: true,
    maxChildren: 32,
    ownershipMode: 'root',
    wideRootNoise: 0,
    rootSymmetrySamples: 1,
  });
  const aborted = await search.run({ visits: VISITS, maxTimeMs: 900_000, batchSize: 4 });
  const a = search.getAnalysis({ topK: 6, analysisPvLen: 6, cloneBuffers: true });

  const svbStats = (search as unknown as { svbTable: Map<string, { deltaUtilitySum: number; weightSum: number }> }).svbTable;
  let usedEntries = 0;
  let maxAbsBias = 0;
  for (const e of svbStats.values()) {
    if (e.weightSum > 0.001) {
      usedEntries++;
      maxAbsBias = Math.max(maxAbsBias, Math.abs(e.deltaUtilitySum / e.weightSum));
    }
  }

  console.log(`aborted=${aborted} visits=${a.rootVisits} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`rootWinRate=${a.rootWinRate.toFixed(4)} rootScoreLead=${a.rootScoreLead.toFixed(2)}`);
  console.log(`top moves: ${a.moves.slice(0, 5).map((m) => `${COLS[m.x]}${19 - m.y}:${m.visits}v:${m.scoreLead.toFixed(1)}`).join(' ')}`);
  console.log(`svb: ${svbStats.size} entries, ${usedEntries} with weight, maxAbsBias=${maxAbsBias.toFixed(4)}`);

  const bad =
    !Number.isFinite(a.rootWinRate) || !Number.isFinite(a.rootScoreLead) ||
    a.rootWinRate < 0 || a.rootWinRate > 1 ||
    a.rootVisits < VISITS * 0.9 ||
    a.moves.length === 0 ||
    a.moves.some((m) => !Number.isFinite(m.scoreLead) || !Number.isFinite(m.winRate)) ||
    svbStats.size === 0 || usedEntries === 0;
  console.log(bad ? 'SANITY: FAIL' : 'SANITY: PASS');
  process.exit(bad ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
