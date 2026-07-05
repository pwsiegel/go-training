// App-facing analysis facade. Two runtimes behind one interface:
//   - browser models (tfjs/WebGPU, vendored engine) — nets in Firebase Storage
//   - a local model (the native KataGo backend via /api/katago) — dev only
// Both report winrate/score from Black's perspective, so they read directly
// through our B+/W+ scoreLabel.

import { getDownloadURL, ref } from 'firebase/storage';
import { getKataGoEngineClient, isKataGoCanceledError } from './engine/katago/client';
import type { KataGoAnalysisPayload } from './engine/katago/types';
import { storage } from '../firebase';
import { analyze as backendAnalyze, type Analysis as BackendAnalysis, type AnalyzeParams } from '../data/katago';
import type { BoardState, Move } from './types';
import type { Color, Stone } from '../types';
import { BOARD_SIZE } from '../types';
import type { GameMove } from '../data/model';

export type AnalysisModel = {
  id: string;
  name: string;
  runtime: string;
  strength: string;        // short strength / speed descriptor for the UI
  kind: 'browser' | 'local';
  netPath?: string;        // browser only — Firebase Storage path
  defaultVisits: number;
};

export const BROWSER_MODELS: AnalysisModel[] = [
  { id: 'b18', name: 'kata1-b18c384nbt', runtime: 'WebGPU', strength: 'strong', kind: 'browser', netPath: 'katago/kata1-b18c384nbt.bin.gz', defaultVisits: 50 },
  { id: 'b6', name: 'g170-b6c96', runtime: 'WebGPU', strength: 'fast, much weaker', kind: 'browser', netPath: 'katago/g170-b6c96.bin.gz', defaultVisits: 100 },
];

// The native KataGo backend (real engine) — only offered when it's reachable
// (dev with `make api`). Same net as the browser b18, full-strength search.
export const LOCAL_MODEL: AnalysisModel = {
  id: 'local', name: 'kata1-b18c384nbt', runtime: 'Metal (native)', strength: 'strong', kind: 'local', defaultVisits: 1000,
};

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
  policyTop: { x: number; y: number } | null;   // net's raw top move (pre-search)
  moves: WebCandidate[];    // best-first
  // Eval of a specifically-requested move (the game's next move), even when the
  // search never visited it. scoreLead is Black-perspective.
  playedEval?: { scoreLead: number; pointsLost: number } | null;
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

/** Argmax over the on-board policy (illegal moves are -1; pass is index 361). */
function policyTopMove(policy: ArrayLike<number>): { x: number; y: number } | null {
  let best = -1;
  let bestVal = -Infinity;
  for (let i = 0; i < BOARD_SIZE * BOARD_SIZE; i++) {
    if (policy[i] > bestVal) { bestVal = policy[i]; best = i; }
  }
  return best >= 0 && bestVal >= 0 ? { x: best % BOARD_SIZE, y: Math.floor(best / BOARD_SIZE) } : null;
}

function toWeb(a: KataGoAnalysisPayload): WebAnalysis {
  return {
    rootWinrate: a.rootWinRate,
    rootScoreLead: a.rootScoreLead,
    rootVisits: a.rootVisits,
    policyTop: policyTopMove(a.policy),
    moves: a.moves.slice(0, 8).map((m) => ({
      x: m.x, y: m.y, winrate: m.winRate, scoreLead: m.scoreLead,
      visits: m.visits, pointsLost: m.pointsLost, order: m.order,
    })),
  };
}

// getDownloadURL is a gated network call (Storage rules) — resolve each net once.
const urlCache = new Map<string, Promise<string>>();
function netUrl(model: AnalysisModel): Promise<string> {
  const path = model.netPath!;
  let url = urlCache.get(path);
  if (!url) { url = getDownloadURL(ref(storage, path)); urlCache.set(path, url); }
  return url;
}

type AnalyzeArgs = {
  model: AnalysisModel;
  stones: Stone[];
  moves: GameMove[];
  toPlay: Color;
  positionId: string;
  visits: number;
  komi?: number;
  signal?: AbortSignal;
  onProgress?: (partial: WebAnalysis) => void;   // browser only — mid-search updates
  // The next move to always eval, with the board after it played (for the
  // fallback value eval when the search never visited that move).
  evalNext?: { move: { x: number; y: number }; stones: Stone[] } | null;
};

/** Analyze one position with the given model at `visits` playouts. Resolves to
 * null when superseded/canceled. When `evalNext` is set, the result carries a
 * `playedEval` for that move even if the search never visited it. */
export async function analyzePosition(args: AnalyzeArgs): Promise<WebAnalysis | null> {
  const analysis = args.model.kind === 'local' ? await analyzeLocal(args) : await analyzeBrowser(args);
  if (!analysis || !args.evalNext) return analysis;
  return { ...analysis, playedEval: await evalPlayedMove(args, analysis) };
}

async function evalPlayedMove(args: AnalyzeArgs, analysis: WebAnalysis): Promise<WebAnalysis['playedEval']> {
  const nm = args.evalNext!.move;
  const cand = analysis.moves.find((m) => m.x === nm.x && m.y === nm.y);
  if (cand) return { scoreLead: cand.scoreLead, pointsLost: cand.pointsLost };
  if (args.signal?.aborted) return null;
  try {
    // The search skipped this move — evaluate the position after it directly.
    const opponent: Color = args.toPlay === 'B' ? 'W' : 'B';
    const childScore = await valueOf(
      args.model,
      args.evalNext!.stones,
      opponent,
      [...args.moves, { color: args.toPlay, x: nm.x, y: nm.y }],
      args.komi,
      args.signal,
    );
    const side = (s: number) => (args.toPlay === 'B' ? s : -s);
    const best = analysis.moves.length ? side(analysis.moves[0].scoreLead) : side(analysis.rootScoreLead);
    return { scoreLead: childScore, pointsLost: Math.max(0, best - side(childScore)) };
  } catch {
    return null;
  }
}

/** Black-perspective score of a position (a fast value estimate). */
async function valueOf(
  model: AnalysisModel, stones: Stone[], toPlay: Color, moves: GameMove[],
  komi: number | undefined, signal?: AbortSignal,
): Promise<number> {
  if (model.kind === 'local') {
    const a = await backendAnalyze({
      initialStones: [],
      moves: moves.map((m) => ({ color: m.color, x: m.x, y: m.y })),
      initialPlayer: moves[0]?.color ?? 'B',
      toPlay,
      maxVisits: 8,
      signal,
    });
    return a.root.score_lead;
  }
  const e = await getKataGoEngineClient().evaluate({
    modelUrl: await netUrl(model),
    backend: 'webgpu',
    board: toBoardState(stones),
    currentPlayer: toPlayer(toPlay),
    moveHistory: toEngineMoves(moves),
    komi: komi ?? 7.5,
    rules: 'chinese',
  });
  return e.rootScoreLead;
}

async function analyzeBrowser(args: AnalyzeArgs): Promise<WebAnalysis | null> {
  // No explicit init(): the worker loads (and caches) the model on first analyze.
  const client = getKataGoEngineClient();
  const modelUrl = await netUrl(args.model);
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
      visits: args.visits,
      topK: 8,
      reportDuringSearchEveryMs: args.onProgress ? 120 : undefined,
      onProgress: args.onProgress ? (p) => args.onProgress!(toWeb(p)) : undefined,
    });
    return toWeb(a);
  } catch (err) {
    if (isKataGoCanceledError(err)) return null;
    throw err;
  }
}

function mapBackend(a: BackendAnalysis, toPlay: Color): WebAnalysis {
  // pointsLost = how far behind the best move, in the side-to-move's score.
  const sideValue = (lead: number) => (toPlay === 'B' ? lead : -lead);
  const best = a.moves.length ? sideValue(a.moves[0].score_lead) : 0;
  // policyTop = the highest-prior legal candidate (the net's raw pick).
  let policyTop: { x: number; y: number } | null = null;
  let bestPrior = -Infinity;
  for (const m of a.moves) {
    if (m.x != null && m.y != null && m.prior > bestPrior) { bestPrior = m.prior; policyTop = { x: m.x, y: m.y }; }
  }
  return {
    rootWinrate: a.root.winrate,
    rootScoreLead: a.root.score_lead,
    rootVisits: a.root.visits,
    policyTop,
    moves: a.moves
      .filter((m) => m.x != null && m.y != null)
      .slice(0, 8)
      .map((m) => ({
        x: m.x as number, y: m.y as number,
        winrate: m.winrate, scoreLead: m.score_lead, visits: m.visits,
        pointsLost: best - sideValue(m.score_lead), order: m.order,
      })),
  };
}

async function analyzeLocal(args: AnalyzeArgs): Promise<WebAnalysis | null> {
  const base: Omit<AnalyzeParams, 'maxVisits'> = {
    initialStones: [],
    moves: args.moves.map((m) => ({ color: m.color, x: m.x, y: m.y })),
    initialPlayer: args.moves[0]?.color ?? 'B',
    toPlay: args.toPlay,
    signal: args.signal,
  };
  try {
    // The backend doesn't stream, so run a fast low-visit pass first to show the
    // top move + spinner while the full search runs. (1 visit returns no
    // candidates; 2 is the minimum that does, and gives the same policy move.)
    if (args.onProgress && args.visits > 2) {
      const quick = await backendAnalyze({ ...base, maxVisits: 2 });
      if (!args.signal?.aborted) args.onProgress(mapBackend(quick, args.toPlay));
    }
    if (args.signal?.aborted) return null;
    return mapBackend(await backendAnalyze({ ...base, maxVisits: args.visits }), args.toPlay);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null;
    throw err;
  }
}
