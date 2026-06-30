import { BOARD_SIZE, type Color, type Stone } from './types';

const N = BOARD_SIZE;
const idx = (x: number, y: number) => y * N + x;
const inBounds = (x: number, y: number) => x >= 0 && x < N && y >= 0 && y < N;

const EMPTY = 0;
const B = 1;
const W = 2;
type Cell = 0 | 1 | 2;

const NBR = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

function colorToCell(c: Color): Cell {
  return c === 'B' ? B : W;
}

function buildBoard(stones: Stone[]): Uint8Array {
  const b = new Uint8Array(N * N);
  for (const s of stones) {
    if (inBounds(s.x, s.y)) b[idx(s.x, s.y)] = colorToCell(s.color);
  }
  return b;
}

function boardToStones(b: Uint8Array): Stone[] {
  const out: Stone[] = [];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const c = b[idx(x, y)];
      if (c === B) out.push({ x, y, color: 'B' });
      else if (c === W) out.push({ x, y, color: 'W' });
    }
  }
  return out;
}

function groupAndLiberties(
  b: Uint8Array,
  x: number,
  y: number,
): { stones: number[]; liberties: Set<number> } {
  const color = b[idx(x, y)];
  const stones: number[] = [];
  const liberties = new Set<number>();
  const seen = new Uint8Array(N * N);
  const stack = [idx(x, y)];
  seen[stack[0]] = 1;
  while (stack.length) {
    const i = stack.pop() as number;
    stones.push(i);
    const sx = i % N;
    const sy = (i - sx) / N;
    for (const [dx, dy] of NBR) {
      const nx = sx + dx;
      const ny = sy + dy;
      if (!inBounds(nx, ny)) continue;
      const ni = idx(nx, ny);
      if (seen[ni]) continue;
      const nc = b[ni];
      if (nc === EMPTY) {
        liberties.add(ni);
      } else if (nc === color) {
        seen[ni] = 1;
        stack.push(ni);
      }
    }
  }
  return { stones, liberties };
}

export type PlayError = 'occupied' | 'suicide' | 'ko' | 'out-of-bounds';

export type PlayMoveResult =
  | {
      ok: true;
      stones: Stone[];
      captured: Stone[];
      koPoint: { x: number; y: number } | null;
    }
  | { ok: false; error: PlayError };

/** Play `color` at (x, y) on top of `stones`. Enforces simple ko (the
 * koPoint, when set, is the only point currently banned because playing
 * there would immediately recapture a single stone), and forbids suicide
 * unless the move captures opposing stones. Returns either the resulting
 * stones list with captured stones broken out, or an error code. */
export function playMove(
  stones: Stone[],
  color: Color,
  x: number,
  y: number,
  koPoint: { x: number; y: number } | null,
): PlayMoveResult {
  if (!inBounds(x, y)) return { ok: false, error: 'out-of-bounds' };
  const b = buildBoard(stones);
  if (b[idx(x, y)] !== EMPTY) return { ok: false, error: 'occupied' };
  if (koPoint && koPoint.x === x && koPoint.y === y) {
    return { ok: false, error: 'ko' };
  }

  const me = colorToCell(color);
  const opp: Cell = me === B ? W : B;
  b[idx(x, y)] = me;

  const captured: number[] = [];
  for (const [dx, dy] of NBR) {
    const nx = x + dx;
    const ny = y + dy;
    if (!inBounds(nx, ny)) continue;
    if (b[idx(nx, ny)] !== opp) continue;
    const g = groupAndLiberties(b, nx, ny);
    if (g.liberties.size === 0) {
      for (const i of g.stones) {
        if (b[i] !== EMPTY) {
          captured.push(i);
          b[i] = EMPTY;
        }
      }
    }
  }

  const own = groupAndLiberties(b, x, y);
  if (own.liberties.size === 0) {
    return { ok: false, error: 'suicide' };
  }

  // Simple ko: only triggered when a single stone was captured *and* the
  // played stone is alone in its group. Connecting to friendly stones
  // disqualifies, since the captured point can't be immediately retaken.
  let nextKo: { x: number; y: number } | null = null;
  if (captured.length === 1 && own.stones.length === 1) {
    const ci = captured[0];
    const cx = ci % N;
    const cy = (ci - cx) / N;
    nextKo = { x: cx, y: cy };
  }

  const oppColor: Color = opp === B ? 'B' : 'W';
  const capturedStones: Stone[] = captured.map((i) => {
    const cx = i % N;
    const cy = (i - cx) / N;
    return { x: cx, y: cy, color: oppColor };
  });

  return {
    ok: true,
    stones: boardToStones(b),
    captured: capturedStones,
    koPoint: nextKo,
  };
}
