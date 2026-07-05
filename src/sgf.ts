// Minimal SGF for full games: generate from a move list, and parse the main
// line back to coloured moves. App coords are (x from left, y from top), which
// maps directly onto SGF points (aa = top-left), so (15,3) -> "pd" (Q16).

import type { GameMove } from './data/model';

const A = 'a'.charCodeAt(0);
const point = (x: number, y: number) => String.fromCharCode(A + x) + String.fromCharCode(A + y);
const esc = (s: string) => s.replace(/([\]\\])/g, '\\$1');

export type SgfMeta = {
  boardSize?: number;
  komi?: number;
  rules?: string;
  playerBlack?: string;
  playerWhite?: string;
  rankBlack?: string;
  rankWhite?: string;
  date?: string;        // YYYY-MM-DD
};

export function toSgf(moves: GameMove[], meta: SgfMeta = {}): string {
  const {
    boardSize = 19, komi = 7.5, rules = 'Chinese',
    playerBlack = '', playerWhite = '', rankBlack = '', rankWhite = '', date = '',
  } = meta;
  const root = [
    'GM[1]', 'FF[4]', `SZ[${boardSize}]`, `KM[${komi}]`, `RU[${esc(rules)}]`,
    playerBlack && `PB[${esc(playerBlack)}]`,
    playerWhite && `PW[${esc(playerWhite)}]`,
    rankBlack && `BR[${esc(rankBlack)}]`,
    rankWhite && `WR[${esc(rankWhite)}]`,
    date && `DT[${date}]`,
  ].filter(Boolean).join('');
  const body = moves.map((m) => `;${m.color}[${point(m.x, m.y)}]`).join('');
  return `(;${root}${body})`;
}

export type SgfInfo = {
  playerBlack: string;
  playerWhite: string;
  rankBlack: string;
  rankWhite: string;
  date: string;
  result: string;       // RE[] value, e.g. "W+0.25" (empty when absent)
};

/** Fox ranks use Chinese dan/kyu suffixes ("5段", "9级"); render them as
 * "5d" / "9k". No-op for ranks that don't use those characters. */
function normalizeRank(rank: string): string {
  return rank.replace(/段/g, 'd').replace(/[级級]/g, 'k');
}

/** Player names + ranks + date + result from an SGF root (empty strings when
 * absent). */
export function sgfInfo(sgf: string): SgfInfo {
  const prop = (key: string) => sgf.match(new RegExp(`\\b${key}\\[([^\\]]*)\\]`))?.[1] ?? '';
  return {
    playerBlack: prop('PB'),
    playerWhite: prop('PW'),
    rankBlack: normalizeRank(prop('BR')),
    rankWhite: normalizeRank(prop('WR')),
    date: prop('DT'),
    result: prop('RE'),
  };
}

/** Main-line coloured moves from an SGF (ignores setup stones, variations, and
 * passes). Tolerant of our own output; not a full SGF parser. */
export function movesFromSgf(sgf: string): GameMove[] {
  const out: GameMove[] = [];
  const re = /;\s*([BW])\[([a-s][a-s])\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sgf)) !== null) {
    out.push({
      color: m[1] as GameMove['color'],
      x: m[2].charCodeAt(0) - A,
      y: m[2].charCodeAt(1) - A,
    });
  }
  return out;
}
