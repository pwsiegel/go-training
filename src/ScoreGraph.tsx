import { useState } from 'react';
import './ScoreGraph.css';

export type ScorePoint = { move: number; lead: number }; // Black perspective (+ = Black ahead)

/** Score-estimate trajectory over a game (Black positive, White negative).
 * Click or drag to seek. Shared by game review and Play's alert mode. */
export function ScoreGraph({ points, total, cursor, onSeek }: {
  points: ScorePoint[];
  total: number;
  cursor: number;
  onSeek: (move: number) => void;
}) {
  const W = 900, H = 150, padL = 44, padR = 16, padT = 14, padB = 22;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const rawMax = Math.max(0, ...points.map((p) => Math.abs(p.lead)));
  const maxAbs = Math.max(10, Math.ceil(rawMax / 5) * 5);
  const xOf = (m: number) => padL + (total > 0 ? (m / total) * plotW : 0);
  const yOf = (lead: number) => padT + plotH / 2 - (lead / maxAbs) * (plotH / 2);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${xOf(p.move).toFixed(1)},${yOf(p.lead).toFixed(1)}`).join(' ');

  const [dragging, setDragging] = useState(false);
  const seekAt = (clientX: number, el: SVGSVGElement) => {
    const rect = el.getBoundingClientRect();
    const vx = ((clientX - rect.left) / rect.width) * W;
    onSeek(Math.round(((vx - padL) / plotW) * total));
  };

  const moveTicks = total > 0
    ? Array.from({ length: 5 }, (_, i) => Math.round((total * (i + 1)) / 5)).filter((m, i, a) => a.indexOf(m) === i)
    : [];

  return (
    <svg
      className="score-graph"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Score estimate over the game (Black positive, White negative)"
      onPointerDown={(e) => { setDragging(true); e.currentTarget.setPointerCapture(e.pointerId); seekAt(e.clientX, e.currentTarget); }}
      onPointerMove={(e) => { if (dragging) seekAt(e.clientX, e.currentTarget); }}
      onPointerUp={() => setDragging(false)}
    >
      <line x1={padL} y1={yOf(maxAbs)} x2={W - padR} y2={yOf(maxAbs)} className="score-graph-grid" />
      <line x1={padL} y1={yOf(0)} x2={W - padR} y2={yOf(0)} className="score-graph-zero" />
      <line x1={padL} y1={yOf(-maxAbs)} x2={W - padR} y2={yOf(-maxAbs)} className="score-graph-grid" />
      <text x={padL - 6} y={yOf(maxAbs) + 4} className="score-graph-ylabel">B+{maxAbs}</text>
      <text x={padL - 6} y={yOf(0) + 4} className="score-graph-ylabel">0</text>
      <text x={padL - 6} y={yOf(-maxAbs) + 4} className="score-graph-ylabel">W+{maxAbs}</text>

      {moveTicks.map((m) => <text key={m} x={xOf(m)} y={H - 6} className="score-graph-xlabel">{m}</text>)}

      {points.length > 0 && <path d={path} className="score-graph-line" fill="none" />}
      {points.map((p) => <circle key={p.move} cx={xOf(p.move)} cy={yOf(p.lead)} r={2.5} className="score-graph-dot" />)}

      <line x1={xOf(cursor)} y1={padT} x2={xOf(cursor)} y2={H - padB} className="score-graph-cursor" />
    </svg>
  );
}
