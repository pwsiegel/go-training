import type { Stone } from './types';
import { BOARD_SIZE } from './types';
import type { NumberedMove } from './numberedMoves';
import './Board.css';

/** Free-form annotation a caller can drop on the board: a text label
 * (e.g. "1", "A") or a shape (triangle, square). Renders on top of the
 * position without modifying stones, on either empty or occupied
 * intersections. */
export type Annotation =
  | { kind: 'label'; x: number; y: number; text: string }
  | { kind: 'triangle' | 'square'; x: number; y: number };

type Props = {
  stones: Stone[];
  /** Called with the intersection clicked and whether Shift was held,
   * so callers can map unmodified vs shifted clicks to different
   * behaviors (e.g. place B vs W). */
  onPlay?: (x: number, y: number, shift: boolean) => void;
  /** When true, clicks fire on every intersection (including occupied
   * ones) so the caller can cycle / remove / overwrite. Default false
   * keeps "place a stone" semantics. */
  editable?: boolean;
  /** Optional viewport to show only a rectangular region of the 19x19.
   * Useful when the caller wants to zoom to the stones of interest. */
  viewport?: { colMin: number; colMax: number; rowMin: number; rowMax: number };
  /** Display-only mode: suppress the hover darkening on empty cells so
   * the board truthfully represents its stones without mouse artifacts.
   * Click handlers are still wired up but no visual hover feedback. */
  displayOnly?: boolean;
  /** Render 0-indexed column numbers above and row numbers to the left
   * of the grid, so a viewer can refer to positions unambiguously when
   * describing what they see. */
  showCoords?: boolean;
  /** Numbered move overlay (solve attempts). Painted on top of the
   * position without adding stones. On an empty intersection the number
   * gets a board-colored halo so it reads against the grid; on an
   * occupied intersection (rare — an initial stone) it uses the
   * existing on-stone label style. Use `computeNumberedOverlay` from
   * `numberedMoves` to derive this from a moves list and to surface
   * any "1…5…8" chains for repeated points. */
  numberedMoves?: NumberedMove[];
  /** Free-form annotations (numbers/letters as `label`, triangles, squares)
   * dropped by the user. Independent of `numberedMoves`. */
  annotations?: Annotation[];
  /** Per-intersection click handler. Fires on every click — including
   * occupied intersections — regardless of `editable`. When supplied,
   * `onPlay` is not called; pass one or the other. */
  onCellClick?: (x: number, y: number) => void;
  /** AI move suggestions (explore-mode), drawn as graded dots with a
   * points-behind-best label. `loss` is points behind the best move
   * (0 = best); color ramps green→amber as it approaches the cutoff. */
  aiCandidates?: { x: number; y: number; loss: number }[];
  /** Highlighted rectangular region (AI region-restricted analysis). */
  region?: { colMin: number; colMax: number; rowMin: number; rowMax: number } | null;
  /** First corner while a region is being selected (shown as a single cell). */
  regionAnchor?: { x: number; y: number } | null;
  /** Thumbnail mode: skip the per-cell click targets — pure display, lighter DOM. */
  thumbnail?: boolean;
};

const PADDING = 30;
const CELL = 32;
const SIZE = PADDING * 2 + CELL * (BOARD_SIZE - 1);
const STONE_R = CELL * 0.47;

const STAR_POINTS: Array<[number, number]> = [
  [3, 3], [3, 9], [3, 15],
  [9, 3], [9, 9], [9, 15],
  [15, 3], [15, 9], [15, 15],
];

const toPx = (i: number) => PADDING + i * CELL;

/** Color ramp for AI dots: green (best) → amber as `t` (loss / cutoff) → 1. */
function aiColor(t: number): string {
  const c = Math.min(1, Math.max(0, t));
  const r = Math.round(46 + (222 - 46) * c);
  const g = Math.round(158 + (170 - 158) * c);
  const b = Math.round(68 + (0 - 68) * c);
  return `rgb(${r}, ${g}, ${b})`;
}

export function Board({
  stones, onPlay, editable = false, viewport,
  displayOnly = false, showCoords = false,
  numberedMoves, annotations, onCellClick, aiCandidates, region, regionAnchor,
  thumbnail = false,
}: Props) {
  const occupied = new Map<string, Stone>();
  for (const s of stones) occupied.set(`${s.x},${s.y}`, s);

  // If a viewport is given, tighten the viewBox around those columns/rows.
  // Extend to the board's outer padding if a side of the viewport is at
  // the board edge (so the outer grid line + padding are visible), else
  // leave a modest buffer inside.
  let vb = `0 0 ${SIZE} ${SIZE}`;
  if (viewport) {
    const BUF = CELL * 0.7;
    const vx0 = viewport.colMin <= 0 ? 0 : toPx(viewport.colMin) - BUF;
    const vy0 = viewport.rowMin <= 0 ? 0 : toPx(viewport.rowMin) - BUF;
    const vx1 = viewport.colMax >= BOARD_SIZE - 1 ? SIZE : toPx(viewport.colMax) + BUF;
    const vy1 = viewport.rowMax >= BOARD_SIZE - 1 ? SIZE : toPx(viewport.rowMax) + BUF;
    vb = `${vx0} ${vy0} ${vx1 - vx0} ${vy1 - vy0}`;
  }

  return (
    <svg
      className={`board${displayOnly ? ' display-only' : ''}`}
      viewBox={vb}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x={0} y={0} width={SIZE} height={SIZE} className="board-bg" />

      {/* AI analysis region highlight */}
      {region && (
        <rect
          x={toPx(region.colMin) - CELL / 2}
          y={toPx(region.rowMin) - CELL / 2}
          width={(region.colMax - region.colMin) * CELL + CELL}
          height={(region.rowMax - region.rowMin) * CELL + CELL}
          fill="rgba(80, 160, 255, 0.12)"
          stroke="rgba(80, 160, 255, 0.75)"
          strokeWidth={1.5}
          strokeDasharray="5 4"
          style={{ pointerEvents: 'none' }}
        />
      )}
      {regionAnchor && !region && (
        <rect
          x={toPx(regionAnchor.x) - CELL / 2}
          y={toPx(regionAnchor.y) - CELL / 2}
          width={CELL}
          height={CELL}
          fill="rgba(80, 160, 255, 0.18)"
          stroke="rgba(80, 160, 255, 0.75)"
          strokeWidth={1.5}
          style={{ pointerEvents: 'none' }}
        />
      )}

      {/* Grid lines */}
      {Array.from({ length: BOARD_SIZE }, (_, i) => (
        <g key={`grid-${i}`}>
          <line
            x1={toPx(i)} y1={toPx(0)}
            x2={toPx(i)} y2={toPx(BOARD_SIZE - 1)}
            className="grid-line"
          />
          <line
            x1={toPx(0)} y1={toPx(i)}
            x2={toPx(BOARD_SIZE - 1)} y2={toPx(i)}
            className="grid-line"
          />
        </g>
      ))}

      {/* Coordinate labels (0-indexed to match internal col/row) */}
      {showCoords && Array.from({ length: BOARD_SIZE }, (_, i) => (
        <g key={`coord-${i}`} className="coord-label">
          <text
            x={toPx(i)} y={PADDING - 12}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={11}
          >{i}</text>
          <text
            x={PADDING - 12} y={toPx(i)}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={11}
          >{i}</text>
        </g>
      ))}

      {/* Star points */}
      {STAR_POINTS.map(([x, y]) => (
        <circle
          key={`star-${x}-${y}`}
          cx={toPx(x)} cy={toPx(y)}
          r={3.5}
          className="star-point"
        />
      ))}

      {/* Click targets */}
      {!thumbnail && Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, i) => {
        const x = i % BOARD_SIZE;
        const y = Math.floor(i / BOARD_SIZE);
        const key = `${x},${y}`;
        const filled = occupied.has(key);
        return (
          <rect
            key={`hit-${key}`}
            x={toPx(x) - CELL / 2}
            y={toPx(y) - CELL / 2}
            width={CELL}
            height={CELL}
            className={onCellClick || !filled || editable ? 'hit' : 'hit occupied'}
            onClick={(e) => {
              if (onCellClick) {
                onCellClick(x, y);
              } else if (onPlay && (editable || !filled)) {
                onPlay(x, y, e.shiftKey);
              }
            }}
          />
        );
      })}

      {/* Stones */}
      {stones.map((s) => (
        <g key={`stone-${s.x}-${s.y}`} style={{ pointerEvents: 'none' }}>
          <circle
            cx={toPx(s.x)} cy={toPx(s.y)}
            r={STONE_R}
            className={s.color === 'B' ? 'stone-black' : 'stone-white'}
          />
          {s.number !== undefined && (
            <text
              x={toPx(s.x)} y={toPx(s.y)}
              className={s.color === 'B' ? 'label-on-black' : 'label-on-white'}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={CELL * 0.5}
            >
              {s.number}
            </text>
          )}
        </g>
      ))}

      {/* Free-form annotations (numbers, letters, triangles, squares) */}
      {annotations?.map((a, i) => {
        const stone = occupied.get(`${a.x},${a.y}`);
        const onStone = stone !== undefined;
        if (a.kind === 'label') {
          const labelClass = onStone
            ? (stone.color === 'B' ? 'label-on-black' : 'label-on-white')
            : 'move-number-empty';
          return (
            <g key={`anno-${i}`} style={{ pointerEvents: 'none' }}>
              {!onStone && (
                <circle
                  cx={toPx(a.x)} cy={toPx(a.y)}
                  r={CELL * 0.36}
                  className="move-number-halo"
                />
              )}
              <text
                x={toPx(a.x)} y={toPx(a.y)}
                className={labelClass}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={CELL * 0.5}
              >
                {a.text}
              </text>
            </g>
          );
        }
        const strokeClass = onStone
          ? (stone.color === 'B' ? 'mark-on-black' : 'mark-on-white')
          : 'mark-on-empty';
        if (a.kind === 'square') {
          const r = CELL * 0.28;
          return (
            <g key={`anno-${i}`} style={{ pointerEvents: 'none' }}>
              <rect
                x={toPx(a.x) - r} y={toPx(a.y) - r}
                width={r * 2} height={r * 2}
                className={strokeClass}
                fill="none"
                strokeWidth={2}
              />
            </g>
          );
        }
        // triangle
        const r = CELL * 0.33;
        const p1 = `${toPx(a.x)},${toPx(a.y) - r}`;
        const p2 = `${toPx(a.x) - r * 0.866},${toPx(a.y) + r * 0.5}`;
        const p3 = `${toPx(a.x) + r * 0.866},${toPx(a.y) + r * 0.5}`;
        return (
          <g key={`anno-${i}`} style={{ pointerEvents: 'none' }}>
            <polygon
              points={`${p1} ${p2} ${p3}`}
              className={strokeClass}
              fill="none"
              strokeWidth={2}
            />
          </g>
        );
      })}

      {/* Numbered-move overlay (solve attempts; no stones added) */}
      {numberedMoves?.map((n) => {
        const stone = occupied.get(`${n.x},${n.y}`);
        const labelClass = stone
          ? (stone.color === 'B' ? 'label-on-black' : 'label-on-white')
          : 'move-number-empty';
        return (
          <g key={`num-${n.x}-${n.y}`} style={{ pointerEvents: 'none' }}>
            {!stone && (
              <circle
                cx={toPx(n.x)} cy={toPx(n.y)}
                r={CELL * 0.36}
                className="move-number-halo"
              />
            )}
            <text
              x={toPx(n.x)} y={toPx(n.y)}
              className={labelClass}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={CELL * 0.5}
            >
              {n.number}
            </text>
          </g>
        );
      })}
      {/* AI move suggestions (graded dots + points-behind-best label) */}
      {aiCandidates?.map((c) => (
        <g key={`ai-${c.x}-${c.y}`} style={{ pointerEvents: 'none' }}>
          <circle
            cx={toPx(c.x)} cy={toPx(c.y)}
            r={STONE_R * 0.9}
            fill={aiColor(Math.min(1, c.loss / 0.5))}
            opacity={0.82}
          />
          <text
            x={toPx(c.x)} y={toPx(c.y)}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={CELL * 0.34}
            fontWeight={600}
            fill="#10240f"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {c.loss.toFixed(1)}
          </text>
        </g>
      ))}
    </svg>
  );
}
