// Client for the native KataGo analysis backend (`/api/katago`) — an optional
// engine offered in local dev when it's reachable (`make api`). The user-facing
// AI (Review, Play, and Explore hints) runs in the browser by default; this
// backend is the "Native (Metal)" model option. Requests go to a relative path
// that Vite proxies to the backend (see vite.config.ts), so no CORS handling is
// needed.
import type { Color, Stone } from '../types';

const API_BASE = import.meta.env.VITE_KATAGO_API ?? '';

export type Candidate = {
  x: number | null;          // null for a pass
  y: number | null;
  move: string;
  order: number;
  visits: number;
  winrate: number;
  score_lead: number;
  prior: number;
  pv: { x: number; y: number }[];
};

export type Analysis = {
  moves: Candidate[];
  root: { winrate: number; score_lead: number; visits: number; current_player: Color };
};

export type Region = { colMin: number; colMax: number; rowMin: number; rowMax: number };

export type AnalyzeParams = {
  initialStones: Stone[];                            // setup position (no move history)
  moves: { color: Color; x: number; y: number }[];   // moves played from the setup
  initialPlayer: Color;                              // who moves first from the setup
  toPlay: Color;                                     // side to move at the position
  allowMoves?: { x: number; y: number }[] | null;    // restrict candidates (region)
  maxVisits?: number;
  signal?: AbortSignal;
};

/** Whether the native KataGo backend is reachable + configured (local dev with
 * `make api`). Used to offer the local full-strength model in review. */
export async function katagoBackendAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/katago/health`);
    return res.ok && (await res.json()).configured === true;
  } catch {
    return false;
  }
}

export async function analyze(p: AnalyzeParams): Promise<Analysis> {
  const res = await fetch(`${API_BASE}/api/katago/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      initial_stones: p.initialStones.map((s) => ({ x: s.x, y: s.y, color: s.color })),
      moves: p.moves.map((m) => ({ color: m.color, x: m.x, y: m.y })),
      initial_player: p.initialPlayer,
      to_play: p.toPlay,
      board_size: 19,
      max_visits: p.maxVisits ?? 1000,
      ...(p.allowMoves ? { allow_moves: p.allowMoves } : {}),
    }),
    signal: p.signal,
  });
  if (!res.ok) throw new Error(`KataGo analyze failed: ${res.status}`);
  return res.json();
}

// --- play vs KataGo (human-net move generation) ---

export type GenmoveResult = {
  move: { x: number; y: number } | null;   // null = pass (opponent never passes in play)
  is_pass: boolean;
  move_prob: number;                        // human-policy probability of the chosen move
  root: { winrate: number; score_lead: number; visits: number; current_player: Color };
};

export type GenmoveParams = {
  initialStones: Stone[];
  moves: { color: Color; x: number; y: number }[];   // full history; the side to move is the opponent
  initialPlayer: Color;
  rank: string;              // humanSLProfile, e.g. "rank_9k"
  temperature?: number;      // 1.0 = faithful rank imitation; <1 sharpens (stronger)
  maxVisits?: number;        // strong-net visits — score readout accuracy only
  signal?: AbortSignal;
};

/** Ask KataGo's human net for one move at the given rank. Sampled from the
 * human policy, so it plays like a human of that rank (mistakes and all). */
export async function genmove(p: GenmoveParams): Promise<GenmoveResult> {
  const res = await fetch(`${API_BASE}/api/katago/genmove`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      initial_stones: p.initialStones.map((s) => ({ x: s.x, y: s.y, color: s.color })),
      moves: p.moves.map((m) => ({ color: m.color, x: m.x, y: m.y })),
      initial_player: p.initialPlayer,
      board_size: 19,
      rank: p.rank,
      temperature: p.temperature ?? 1.0,
      max_visits: p.maxVisits ?? 100,
    }),
    signal: p.signal,
  });
  if (!res.ok) throw new Error(`KataGo genmove failed: ${res.status}`);
  return res.json();
}
