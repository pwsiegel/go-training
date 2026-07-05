import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Board, type Annotation } from '../Board';
import { replay } from '../goRules';
import { movesFromSgf, sgfInfo } from '../sgf';
import { getGame } from '../data/games';
import type { GameDoc } from '../data/model';
import type { Color } from '../types';
import { analyzePosition, type WebAnalysis } from '../katago/webEngine';
import { Spinner } from '../Spinner';
import './GameReview.css';

const COLS = 'ABCDEFGHJKLMNOPQRST';
const coordLabel = (x: number, y: number) => `${COLS[x]}${19 - y}`;
const scoreLabel = (lead: number) => `${lead >= 0 ? 'B' : 'W'}+${Math.abs(lead).toFixed(1)}`;

type Point = { move: number; lead: number };

/** Most recent recorded estimate at or before `move`, else null. */
function scoreBefore(points: Point[], move: number): number | null {
  let best: number | null = null;
  for (const p of points) {
    if (p.move <= move) best = p.lead; else break;
  }
  return best;
}

export function GameReview() {
  const { id } = useParams<{ id: string }>();
  const [loaded, setLoaded] = useState<{ id: string; game: GameDoc | null } | null>(null);
  const [cursor, setCursor] = useState(0);
  const [analyzeOn, setAnalyzeOn] = useState(false);
  const [analysis, setAnalysis] = useState<{ cursor: number; data: WebAnalysis } | null>(null);
  const [analysisErr, setAnalysisErr] = useState('');

  useEffect(() => {
    let active = true;
    getGame(id ?? '').then((g) => {
      if (!active) return;
      setLoaded({ id: id ?? '', game: g });
      setCursor(g ? movesFromSgf(g.sgf).length : 0);
    });
    return () => { active = false; };
  }, [id]);

  const loading = !loaded || loaded.id !== id;
  const game = loading ? null : loaded.game;
  const moves = useMemo(() => (game ? movesFromSgf(game.sgf) : []), [game]);
  const total = moves.length;

  const points = useMemo<Point[]>(() => {
    if (!game) return [];
    return Object.entries(game.scoreAt ?? {})
      .map(([k, v]) => ({ move: Number(k), lead: v }))
      .sort((a, b) => a.move - b.move);
  }, [game]);

  const shown = useMemo(() => replay(moves.slice(0, cursor)), [moves, cursor]);

  const activeRef = useRef<HTMLLIElement>(null);
  useEffect(() => { activeRef.current?.scrollIntoView({ block: 'nearest' }); }, [cursor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') setCursor((c) => Math.max(0, c - 1));
      else if (e.key === 'ArrowRight') setCursor((c) => Math.min(total, c + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [total]);

  // In-browser KataGo analysis of the current position (opt-in). Scrubbing to a
  // new position cancels the stale search (shared 'interactive' engine group).
  useEffect(() => {
    if (!analyzeOn || !game) return;
    let active = true;
    const forCursor = cursor;
    const toPlay: Color =
      cursor < moves.length ? moves[cursor].color
        : cursor > 0 ? (moves[cursor - 1].color === 'B' ? 'W' : 'B')
          : 'B';
    analyzePosition({
      stones: shown.stones,
      moves: moves.slice(0, cursor),
      toPlay,
      positionId: `${id}:${cursor}`,
      visits: 50,
    })
      .then((res) => {
        if (!active || res === null) return;
        setAnalysis({ cursor: forCursor, data: res });
        setAnalysisErr('');
      })
      .catch((e) => {
        if (!active) return;
        setAnalysisErr(e instanceof Error ? e.message : 'analysis failed');
      });
    return () => { active = false; };
  }, [analyzeOn, game, id, moves, cursor, shown]);

  if (loading) return <div className="center-screen"><Spinner /></div>;
  if (!game) {
    return (
      <div className="gr">
        <p>Game not found.</p>
        <Link to="/review">← Back to games</Link>
      </div>
    );
  }

  const mark = cursor > 0 ? moves[cursor - 1] : null;
  const annotations: Annotation[] = mark ? [{ kind: 'triangle', x: mark.x, y: mark.y }] : [];
  const cursorScore = scoreBefore(points, cursor);
  const info = sgfInfo(game.sgf);
  const seek = (m: number) => setCursor(Math.max(0, Math.min(total, m)));
  const when = new Date(game.createdAt).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
  const currentAnalysis = analyzeOn && analysis && analysis.cursor === cursor ? analysis.data : null;
  const playedNext = cursor < total ? moves[cursor] : null;
  const playedCand = currentAnalysis && playedNext
    ? currentAnalysis.moves.find((m) => m.x === playedNext.x && m.y === playedNext.y)
    : null;
  const aiCandidates = currentAnalysis
    ? currentAnalysis.moves.map((m) => ({ x: m.x, y: m.y, loss: m.pointsLost }))
    : undefined;

  return (
    <div className="gr">
      <div className="gr-head">
        <Link to="/review" className="gr-back">← Games</Link>
        <h1 className="gr-players">
          {info.playerBlack} <span className="gr-rank">[{info.rankBlack}]</span> vs.{' '}
          {info.playerWhite} <span className="gr-rank">[{info.rankWhite}]</span>
        </h1>
        <p className="gr-meta">
          {when}
          {game.myColor && <> · you played {game.myColor === 'B' ? 'Black' : 'White'}</>}
          {' · '}{total} moves
          {game.finalScore != null
            ? <> · final estimate <strong>{scoreLabel(game.finalScore)}</strong></>
            : info.result && <> · <strong>{info.result}</strong></>}
        </p>
        <button
          type="button"
          className={analyzeOn ? 'gr-analyze-btn active' : 'gr-analyze-btn'}
          onClick={() => setAnalyzeOn((o) => !o)}
        >
          {analyzeOn ? 'KataGo: on' : 'Analyze (KataGo)'}
        </button>
      </div>

      {points.length > 0 && (
        <GameScoreGraph points={points} total={total} cursor={cursor} onSeek={seek} />
      )}

      <div className="gr-main">
        <div className="gr-board">
          <Board stones={shown.stones} annotations={annotations} aiCandidates={aiCandidates} />
          <div className="gr-scrub">
            <button type="button" onClick={() => seek(0)} disabled={cursor === 0} aria-label="Start">⏮</button>
            <button type="button" onClick={() => seek(cursor - 1)} disabled={cursor === 0} aria-label="Previous">◀</button>
            <input type="range" min={0} max={total} value={cursor} onChange={(e) => seek(Number(e.target.value))} aria-label="Move" />
            <button type="button" onClick={() => seek(cursor + 1)} disabled={cursor === total} aria-label="Next">▶</button>
            <button type="button" onClick={() => seek(total)} disabled={cursor === total} aria-label="End">⏭</button>
          </div>
          <div className="gr-status">
            move {cursor} / {total}
            {cursorScore !== null && <> · estimate <strong>{scoreLabel(cursorScore)}</strong></>}
            {analyzeOn && (
              analysisErr ? <> · <span className="gr-analyze-err">{analysisErr}</span></>
                : currentAnalysis ? (
                  <>
                    {' · '}KataGo <strong>{scoreLabel(currentAnalysis.rootScoreLead)}</strong>
                    {' · '}{(currentAnalysis.rootWinrate * 100).toFixed(0)}% B
                    {' · '}{currentAnalysis.rootVisits}v
                    {playedNext && playedCand && (
                      <> · played {coordLabel(playedNext.x, playedNext.y)} (−{playedCand.pointsLost.toFixed(1)})</>
                    )}
                  </>
                ) : <> · analyzing…</>
            )}
          </div>
        </div>

        <ol className="gr-movelist">
          {moves.map((m, i) => (
            <li key={i} ref={cursor === i + 1 ? activeRef : null} className={cursor === i + 1 ? 'active' : ''}>
              <button type="button" onClick={() => seek(i + 1)}>
                <span className="mv-num">{i + 1}</span>
                <span className={`mv-color mv-${m.color}`} aria-hidden />
                <span className="mv-coord">{coordLabel(m.x, m.y)}</span>
                {game.scoreAt?.[String(i + 1)] !== undefined && (
                  <span className="mv-score">{scoreLabel(game.scoreAt[String(i + 1)])}</span>
                )}
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function GameScoreGraph({
  points, total, cursor, onSeek,
}: {
  points: Point[];
  total: number;
  cursor: number;
  onSeek: (move: number) => void;
}) {
  const W = 900, H = 240, padL = 44, padR = 16, padT = 18, padB = 26;
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
      className="gr-graph"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Score estimate over the game (Black positive, White negative)"
      onPointerDown={(e) => { setDragging(true); e.currentTarget.setPointerCapture(e.pointerId); seekAt(e.clientX, e.currentTarget); }}
      onPointerMove={(e) => { if (dragging) seekAt(e.clientX, e.currentTarget); }}
      onPointerUp={() => setDragging(false)}
    >
      {/* score gridlines + labels */}
      <line x1={padL} y1={yOf(maxAbs)} x2={W - padR} y2={yOf(maxAbs)} className="gr-graph-grid" />
      <line x1={padL} y1={yOf(0)} x2={W - padR} y2={yOf(0)} className="gr-graph-zero" />
      <line x1={padL} y1={yOf(-maxAbs)} x2={W - padR} y2={yOf(-maxAbs)} className="gr-graph-grid" />
      <text x={padL - 6} y={yOf(maxAbs) + 4} className="gr-graph-ylabel">B+{maxAbs}</text>
      <text x={padL - 6} y={yOf(0) + 4} className="gr-graph-ylabel">0</text>
      <text x={padL - 6} y={yOf(-maxAbs) + 4} className="gr-graph-ylabel">W+{maxAbs}</text>

      {/* move-number ticks */}
      {moveTicks.map((m) => (
        <text key={m} x={xOf(m)} y={H - 8} className="gr-graph-xlabel">{m}</text>
      ))}

      {points.length > 0 && <path d={path} className="gr-graph-line" fill="none" />}
      {points.map((p) => <circle key={p.move} cx={xOf(p.move)} cy={yOf(p.lead)} r={2.5} className="gr-graph-dot" />)}

      <line x1={xOf(cursor)} y1={padT} x2={xOf(cursor)} y2={H - padB} className="gr-graph-cursor" />
    </svg>
  );
}
