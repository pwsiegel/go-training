import { useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import './ReviewGraph.css';

type Point = { move: number; lead: number };

const scoreLabel = (lead: number) => `${lead >= 0 ? 'B' : 'W'}+${Math.abs(lead).toFixed(1)}`;

/** The score-timeline graph in game review; it doubles as the move scrubber —
 * click or drag anywhere to seek. Black positive (up), White negative (down),
 * on a data-fit Y axis (min/max estimate padded out to a multiple of 5). Reads
 * the same trajectory the review computes. */
export function ReviewGraph({ points, total, cursor, onSeek }: {
  points: Point[];
  total: number;
  cursor: number;
  onSeek: (move: number) => void;
}) {
  const W = 580, H = 260, pad = 14;
  // Data-fit Y axis: span the actual min/max estimate plus a small margin, so
  // the curve fills the height instead of sitting in a symmetric ±max range.
  const leads = points.map((p) => p.lead);
  const dataMin = leads.length ? Math.min(...leads) : -10;
  const dataMax = leads.length ? Math.max(...leads) : 10;
  // Keep ≥3 points of headroom past the data, snapped out to a multiple of 5.
  const axisMax = Math.ceil((dataMax + 3) / 5) * 5;
  const axisMin = Math.floor((dataMin - 3) / 5) * 5;
  const plotTop = pad, plotBot = H - pad;
  const xOf = (m: number) => (total > 0 ? (m / total) * W : 0);
  const yOf = (lead: number) => plotBot - ((lead - axisMin) / (axisMax - axisMin)) * (plotBot - plotTop);
  const zeroInRange = axisMin < 0 && axisMax > 0;
  const zeroY = yOf(0);
  const baseY = Math.max(plotTop, Math.min(plotBot, zeroY));   // area-fill baseline

  // Most recent estimate at or before a move — for the playhead / hover dot.
  const leadAt = (m: number): number | null => {
    let best: number | null = null;
    for (const p of points) { if (p.move <= m) best = p.lead; else break; }
    return best;
  };

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${xOf(p.move).toFixed(1)},${yOf(p.lead).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  const area = points.length
    ? `${line} L${xOf(last.move).toFixed(1)},${baseY.toFixed(1)} L${xOf(points[0].move).toFixed(1)},${baseY.toFixed(1)} Z`
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
          {zeroInRange && <line x1={0} y1={zeroY} x2={W} y2={zeroY} className="rg-zero" />}
          {area && <path d={area} className="rg-area" />}
          {line && <path d={line} className="rg-line" />}
          {hover != null && <line x1={xOf(hover)} y1={0} x2={xOf(hover)} y2={H} className="rg-hover-line" />}
          <line x1={xOf(cursor)} y1={0} x2={xOf(cursor)} y2={H} className="rg-playhead" />
          {curLead != null && <circle cx={xOf(cursor)} cy={yOf(curLead)} r={3.5} className="rg-dot" />}
        </svg>
        <span className="rg-corner rg-corner-top">{axisMax >= 0 ? 'B' : 'W'}+{Math.abs(axisMax)}</span>
        <span className="rg-corner rg-corner-bot">{axisMin >= 0 ? 'B' : 'W'}+{Math.abs(axisMin)}</span>
        {zeroInRange && <span className="rg-zero-label" style={{ top: `${(zeroY / H) * 100}%` }}>even</span>}
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
