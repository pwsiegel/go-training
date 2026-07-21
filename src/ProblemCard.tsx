import { Board } from './Board';
import { computeNumberedOverlay } from './numberedMoves';
import { boundingViewport } from './stones';
import type { Stone } from './types';
import type { Verdict } from './data/model';
import './ProblemCard.css';

const MARK: Record<string, string> = { correct: '✓', incorrect: '✗', flag: '⚑', pending: '?' };

type Viewport = { colMin: number; colMax: number; rowMin: number; rowMax: number };

/** Expand a viewport to a square (clamped to the board) so every card's board
 * fills its square frame identically rather than centering at varying sizes. */
function square(v: Viewport): Viewport {
  const target = Math.max(v.colMax - v.colMin, v.rowMax - v.rowMin);
  const fit = (min: number, max: number): [number, number] => {
    const grow = target - (max - min);
    let lo = min - Math.floor(grow / 2);
    let hi = max + Math.ceil(grow / 2);
    if (lo < 0) { hi = Math.min(18, hi - lo); lo = 0; }
    if (hi > 18) { lo = Math.max(0, lo - (hi - 18)); hi = 18; }
    return [lo, hi];
  };
  const [colMin, colMax] = fit(v.colMin, v.colMax);
  const [rowMin, rowMax] = fit(v.rowMin, v.rowMax);
  return { colMin, colMax, rowMin, rowMax };
}

export type ProblemCardProps = {
  /** The problem position. */
  stones: Stone[];
  /** Played moves, overlaid as numbered markers. */
  moves?: { x: number; y: number }[];
  /** Collection it comes from (shown at the top). */
  collection?: string;
  /** Problem number, shown as "#N" at the bottom. */
  number?: number;
  /** Verdict — drives the colored border and the verdict bar. */
  verdict?: Verdict | 'pending' | null;
  /** Show the "↻ retried" marker. */
  retried?: boolean;
  /** Show the "⚑ stuck" marker (problem is in the student's stuck set). */
  stuck?: boolean;
  /** Render the verdict bar. Off where interactive controls replace it (grading). */
  bar?: boolean;
  /** Extra classes for external composition (e.g. a "dirty" highlight). */
  className?: string;
};

/** The single problem card used everywhere — collections, submissions, history,
 * attempts, review. Pure display; interactions (links, remove ×, grading
 * buttons) are composed externally, and the size is set by the parent grid. */
export function ProblemCard({
  stones, moves, collection, number, verdict, retried, stuck, bar = true, className,
}: ProblemCardProps) {
  const overlay = moves && moves.length ? computeNumberedOverlay(moves) : null;
  const pts = (moves ?? []).map((m) => ({ x: m.x, y: m.y, color: 'B' as const }));
  const vp = boundingViewport([...stones, ...pts], 3);
  const viewport = vp ? square(vp) : undefined;
  return (
    <div className={`problem-card${verdict ? ` v-${verdict}` : ''}${stuck ? ' is-stuck' : ''}${className ? ` ${className}` : ''}`}>
      {collection && <div className="problem-card-collection" title={collection}>{collection}</div>}
      <div className="problem-card-board">
        <Board stones={stones} numberedMoves={overlay?.boardNumbers} viewport={viewport} displayOnly />
      </div>
      {(number !== undefined || retried || stuck) && (
        <div className="problem-card-footer">
          {number !== undefined && <span className="problem-card-num">#{number}</span>}
          {retried && <span className="problem-card-retried">↻ retried</span>}
          {stuck && verdict && <span className="problem-card-stuck">? stuck</span>}
        </div>
      )}
      {bar && verdict && <div className={`problem-card-bar v-${verdict}`}>{MARK[verdict]}</div>}
      {bar && !verdict && stuck && <div className="problem-card-bar v-stuck">?</div>}
    </div>
  );
}
