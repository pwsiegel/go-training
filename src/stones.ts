// Adapt library/Firestore stones ({col,row,color:"B"|"W"}) to the renderer's
// Stone ({x,y,color}). The board uses x=col, y=row.

import type { Color, Stone } from './types';
import type { LibStone } from './data/model';

export function toStones(libStones: LibStone[]): Stone[] {
  return libStones.map((s) => ({
    x: s.col,
    y: s.row,
    color: (s.color === 'W' ? 'W' : 'B') as Color,
  }));
}

/** Solve-mode viewport: framed on the problem's stones alone, so playing
 * moves never rescales the board. A move outside the frame (rare) expands
 * it just enough to stay visible. */
export function solveViewport(stones: Stone[], moves: { x: number; y: number }[], margin = 5) {
  const vp = boundingViewport(stones, margin);
  if (!vp) return undefined;
  for (const m of moves) {
    vp.colMin = Math.min(vp.colMin, Math.max(0, m.x - 1));
    vp.colMax = Math.max(vp.colMax, Math.min(18, m.x + 1));
    vp.rowMin = Math.min(vp.rowMin, Math.max(0, m.y - 1));
    vp.rowMax = Math.max(vp.rowMax, Math.min(18, m.y + 1));
  }
  return vp;
}

/** Tight viewport around a set of stones, clamped to the board, with a margin. */
export function boundingViewport(stones: Stone[], margin = 2) {
  if (stones.length === 0) return undefined;
  const xs = stones.map((s) => s.x);
  const ys = stones.map((s) => s.y);
  return {
    colMin: Math.max(0, Math.min(...xs) - margin),
    colMax: Math.min(18, Math.max(...xs) + margin),
    rowMin: Math.max(0, Math.min(...ys) - margin),
    rowMax: Math.min(18, Math.max(...ys) + margin),
  };
}
