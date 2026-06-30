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
