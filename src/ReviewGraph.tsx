import { useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import './ReviewGraph.css';

type Point = { move: number; lead: number };

const scoreLabel = (lead: number) => `${lead >= 0 ? 'B' : 'W'}+${Math.abs(lead).toFixed(1)}`;

/** The score-timeline graph in game review; it doubles as the move scrubber —
 * click or drag anywhere to seek. Black positive (up), White negative (down),
 * with an auto-scaled range. Reads the same trajectory the review computes. */
export function ReviewGraph({ points, total, cursor, onSeek }: {
  points: Point[];
  total: number;
  cursor: number;
  onSeek: (move: number) => void;
}) {
  const W = 580, H = 260, pad = 14;
  const midY = H / 2;
  const rawMax = Math.max(0, ...points.map((p) => Math.abs(p.lead)));
  const maxAbs = Math.max(10, Math.ceil(rawMax / 5) * 5);
  const scale = (H / 2 - pad) / maxAbs;
  const xOf = (m: number) => (total > 0 ? (m / total) * W : 0);
  const yOf = (lead: number) => midY - lead * scale;

  // Most recent estimate at or before a move — for the playhead / hover dot.
  const leadAt = (m: number): number | null => {
    let best: number | null = null;
    for (const p of points) { if (p.move <= m) best = p.lead; else break; }
    return best;
  };

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${xOf(p.move).toFixed(1)},${yOf(p.lead).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  const area = points.length
    ? `${line} L${xOf(last.move).toFixed(1)},${midY} L${xOf(points[0].move).toFixed(1)},${midY} Z`
    : '';

  const [hover, setHover] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const moveAt = (clientX: number): number => {
    const el = wrapRef.current;
    if (!el) return cursor;
    const r = el.getBoundingClientRect();
    return Math.round(((clientX - r.left) / r.width) * total);
  };
  const down = (e: RPointerEvent<HTMLDivElement>) => {
    onSeek(moveAt(e.clientX));
    const mv = (ev: PointerEvent) => onSeek(moveAt(ev.clientX));
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };

  const curLead = leadAt(cursor);
  const hoverLead = hover != null ? leadAt(hover) : null;
  const ticks = total > 0 ? [1, 2, 3, 4].map((k) => Math.round((k / 4) * total)) : [];

  return (
    <div
      ref={wrapRef}
      className="rg-wrap"
      onPointerDown={down}
      onPointerMove={(e) => setHover(Math.max(0, Math.min(total, moveAt(e.clientX))))}
      onPointerLeave={() => setHover(null)}
    >
      <div className="rg-chart">
        <svg className="rg-svg" viewBox={`0 0 ${W} ${H}`} role="img"
          aria-label="Score estimate over the game (Black up, White down); click or drag to seek">
          <line x1={0} y1={midY} x2={W} y2={midY} className="rg-zero" />
          {area && <path d={area} className="rg-area" />}
          {line && <path d={line} className="rg-line" />}
          {hover != null && <line x1={xOf(hover)} y1={0} x2={xOf(hover)} y2={H} className="rg-hover-line" />}
          <line x1={xOf(cursor)} y1={0} x2={xOf(cursor)} y2={H} className="rg-playhead" />
          {curLead != null && <circle cx={xOf(cursor)} cy={yOf(curLead)} r={3.5} className="rg-dot" />}
        </svg>
        <span className="rg-corner rg-corner-top">B+{maxAbs}</span>
        <span className="rg-corner rg-corner-bot">W+{maxAbs}</span>
        {hover != null && hoverLead != null && (
          <div className="rg-tip" style={{ left: `${Math.min(92, Math.max(8, (hover / Math.max(1, total)) * 100))}%` }}>
            Move {hover} · {scoreLabel(hoverLead)}
          </div>
        )}
      </div>
      <div className="rg-ticks">{ticks.map((t, i) => <span key={i}>{t}</span>)}</div>
    </div>
  );
}
