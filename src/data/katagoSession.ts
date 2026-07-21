// Streaming session analysis against the native backend: POST
// /api/katago/session returns NDJSON — one kata-analyze report per line
// ({moves, root, ownership}, Black perspective) until the target visits are
// reached or the request is aborted. Aborting stops the engine's search; the
// backend GTP engine keeps its tree across sessions whose positions differ by
// played/undone moves, so navigation continues the previous search.
import type { Analysis } from './katago';
import type { Color, Stone } from '../types';

const API_BASE = import.meta.env.VITE_KATAGO_API ?? '';

export type SessionReport = Analysis & { error?: string };

export async function streamNativeAnalysis(p: {
  initialStones: Stone[];
  moves: { color: Color; x: number; y: number }[];
  toPlay: Color;
  maxVisits: number;
  allowMoves?: { x: number; y: number }[] | null;
  signal: AbortSignal;
  onReport: (report: Analysis) => void;
}): Promise<void> {
  const res = await fetch(`${API_BASE}/api/katago/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      initial_stones: p.initialStones.map((s) => ({ x: s.x, y: s.y, color: s.color })),
      moves: p.moves.map((m) => ({ color: m.color, x: m.x, y: m.y })),
      initial_player: p.moves[0]?.color ?? 'B',
      to_play: p.toPlay,
      board_size: 19,
      max_visits: p.maxVisits,
      ...(p.allowMoves ? { allow_moves: p.allowMoves } : {}),
    }),
    signal: p.signal,
  });
  if (!res.ok || !res.body) throw new Error(`KataGo session failed: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const report = JSON.parse(line) as SessionReport;
      if (report.error) throw new Error(report.error);
      p.onReport(report);
    }
  }
}
