// App-facing wrapper around the vendored in-browser KataGo engine (tfjs/WebGPU).
// Bridges our game types (Stone/GameMove) to the engine's BoardState/Move and
// returns a trimmed analysis. Runs fully client-side — no backend.
//
// Nets are hosted in Firebase Storage (katago/, allowlist-gated) and fetched by
// download URL, so this works on the deployed static app with no server.

import { getDownloadURL, ref } from 'firebase/storage';
import { getKataGoEngineClient, isKataGoCanceledError } from './engine/katago/client';
import { storage } from '../firebase';
import type { BoardState, Move } from './types';
import type { Color, Stone } from '../types';
import { BOARD_SIZE } from '../types';
import type { GameMove } from '../data/model';

export type KataGoNet = { id: string; label: string; path: string };
export const KATAGO_NETS: KataGoNet[] = [
  { id: 'b18', label: 'Strong · b18', path: 'katago/kata1-b18c384nbt.bin.gz' },
  { id: 'b6', label: 'Fast · b6', path: 'katago/g170-b6c96.bin.gz' },
];

// getDownloadURL is a gated network call (Storage rules) — resolve each net once.
const urlCache = new Map<string, Promise<string>>();
function netUrl(net: KataGoNet): Promise<string> {
  let url = urlCache.get(net.path);
  if (!url) { url = getDownloadURL(ref(storage, net.path)); urlCache.set(net.path, url); }
  return url;
}

// All winrate/score values are from Black's perspective (as the engine reports
// them), so they read directly through our B+/W+ `scoreLabel`.
export type WebCandidate = {
  x: number;
  y: number;
  winrate: number;      // 0..1, Black
  scoreLead: number;    // points, Black perspective
  visits: number;
  pointsLost: number;   // points behind the best move (0 = best), perspective-free
  order: number;
};

export type WebAnalysis = {
  rootWinrate: number;      // 0..1, Black
  rootScoreLead: number;    // points, Black perspective
  rootVisits: number;
  moves: WebCandidate[];    // best-first
};

const toPlayer = (c: Color) => (c === 'B' ? 'black' : 'white');

function toBoardState(stones: Stone[]): BoardState {
  const board: BoardState = Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => null),
  );
  for (const s of stones) board[s.y][s.x] = s.color === 'B' ? 'black' : 'white';
  return board;
}

const toEngineMoves = (moves: GameMove[]): Move[] =>
  moves.map((m) => ({ x: m.x, y: m.y, player: toPlayer(m.color) }));

/** Analyze one position at `visits` playouts. Requests share the `interactive`
 * group so scrubbing to a new position cancels the stale search. Resolves to
 * null when superseded/canceled. */
export async function analyzePosition(args: {
  net: KataGoNet;
  stones: Stone[];
  moves: GameMove[];
  toPlay: Color;
  positionId: string;
  komi?: number;
  visits?: number;
}): Promise<WebAnalysis | null> {
  // No explicit init(): the worker loads (and caches) the model on the first
  // analyze. Calling init() per-analyze collided ("Init already in progress")
  // when scrubbing fired overlapping requests.
  const client = getKataGoEngineClient();
  const modelUrl = await netUrl(args.net);
  try {
    const a = await client.analyze({
      analysisGroup: 'interactive',
      positionId: args.positionId,
      modelUrl,
      backend: 'webgpu',
      board: toBoardState(args.stones),
      currentPlayer: toPlayer(args.toPlay),
      moveHistory: toEngineMoves(args.moves),
      komi: args.komi ?? 7.5,
      rules: 'chinese',
      visits: args.visits ?? 50,
      topK: 8,
    });
    return {
      rootWinrate: a.rootWinRate,
      rootScoreLead: a.rootScoreLead,
      rootVisits: a.rootVisits,
      moves: a.moves.slice(0, 8).map((m) => ({
        x: m.x,
        y: m.y,
        winrate: m.winRate,
        scoreLead: m.scoreLead,
        visits: m.visits,
        pointsLost: m.pointsLost,
        order: m.order,
      })),
    };
  } catch (err) {
    if (isKataGoCanceledError(err)) return null;
    throw err;
  }
}
