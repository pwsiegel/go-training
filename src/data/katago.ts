// Client for the local KataGo analysis bridge (explore-mode AI hints). Only
// reachable in local dev when the backend runs with the analysis engine
// (`make api-katago`); the toggle that calls it is hidden unless VITE_KATAGO=1.
// Requests go to a relative path that Vite proxies to the backend (see
// vite.config.ts), so no CORS handling is needed.
import type { Color, Stone } from '../types';

const API_BASE = import.meta.env.VITE_KATAGO_API ?? '';

/** Whether to surface the explore-mode AI toggle at all (local dev only). */
export const KATAGO_ENABLED = import.meta.env.VITE_KATAGO === '1';

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
