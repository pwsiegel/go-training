import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useLocation } from 'react-router-dom';
import { useAuth } from '../auth';
import { Board, type Annotation } from '../Board';
import { playMove, replay } from '../goRules';
import { movesFromSgf, sgfInfo } from '../sgf';
import { gameOutcome, getGame } from '../data/games';
import { listFoxAccounts } from '../data/fox';
import type { GameDoc } from '../data/model';
import type { Color, Stone } from '../types';
import { analyzePosition, scoreTrajectory, BROWSER_MODELS, LOCAL_MODEL, type WebAnalysis } from '../katago/webEngine';
import { katagoBackendAvailable } from '../data/katago';
import { Spinner } from '../Spinner';
import { ScoreGraph } from '../ScoreGraph';
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
  const location = useLocation();
  const { user } = useAuth();
  // A just-played game handed straight to review without saving (router state).
  const previewGame = (location.state as { game?: GameDoc } | null)?.game;
  const [loaded, setLoaded] = useState<{ id: string; game: GameDoc | null } | null>(null);
  const [myUids, setMyUids] = useState<Set<number>>(new Set());
  const [cursor, setCursor] = useState(0);
  const [analyzeOn, setAnalyzeOn] = useState(false);
  const [modelId, setModelId] = useState(BROWSER_MODELS[0].id);
  const [visitsByModel, setVisitsByModel] = useState<Record<string, number>>(
    () => Object.fromEntries([...BROWSER_MODELS, LOCAL_MODEL].map((m) => [m.id, m.defaultVisits])),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [localAvailable, setLocalAvailable] = useState(false);
  const [analysis, setAnalysis] = useState<{ cursor: number; data: WebAnalysis } | null>(null);
  const [analysisErr, setAnalysisErr] = useState('');
  const [partialTop, setPartialTop] = useState<{ cursor: number; x: number; y: number } | null>(null);
  // Score estimates gathered from live analysis, keyed by move — so the graph
  // fills in for any game (not just AI games that recorded scores while played).
  const [analyzedScores, setAnalyzedScores] = useState<Record<number, number>>({});
  const settingsRef = useRef<HTMLDivElement>(null);

  // Offer the native-backend model only when it's reachable (dev with `make api`).
  const models = useMemo(
    () => (localAvailable ? [...BROWSER_MODELS, LOCAL_MODEL] : BROWSER_MODELS),
    [localAvailable],
  );
  const model = models.find((m) => m.id === modelId) ?? models[0];
  const visits = visitsByModel[model.id] ?? model.defaultVisits;

  useEffect(() => {
    let on = true;
    katagoBackendAvailable().then((ok) => { if (on) setLocalAvailable(ok); });
    return () => { on = false; };
  }, []);

  // Close the settings menu on an outside click.
  useEffect(() => {
    if (!settingsOpen) return;
    const onDown = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) setSettingsOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [settingsOpen]);

  useEffect(() => {
    if (previewGame) return;
    let active = true;
    getGame(id ?? '').then((g) => {
      if (active) setLoaded({ id: id ?? '', game: g });
    });
    return () => { active = false; };
  }, [id, previewGame]);

  const loading = !previewGame && (!loaded || loaded.id !== id);
  const game = previewGame ?? (loading ? null : loaded?.game ?? null);
  const moves = useMemo(() => (game ? movesFromSgf(game.sgf) : []), [game]);
  const total = moves.length;

  // Start the cursor at the end whenever a different game is shown (render-time
  // adjustment rather than a setState-in-effect).
  const [cursorForGame, setCursorForGame] = useState<GameDoc | null>(null);
  if (game && game !== cursorForGame) {
    setCursorForGame(game);
    setCursor(total);
    setAnalyzedScores({});
  }

  // Which participant (if any) is one of the game owner's own accounts — for the
  // win/loss accent. Readable by the owner and, per the rules, a linked teacher.
  useEffect(() => {
    if (!game || game.source !== 'fox') return;
    let on = true;
    listFoxAccounts(game.ownerUid)
      .then((a) => { if (on) setMyUids(new Set(a.filter((x) => x.isMine).map((x) => x.uid))); })
      .catch(() => { if (on) setMyUids(new Set()); });
    return () => { on = false; };
  }, [game]);

  const points = useMemo<Point[]>(() => {
    const merged: Record<number, number> = {};
    for (const [k, v] of Object.entries(game?.scoreAt ?? {})) merged[Number(k)] = v;
    for (const [k, v] of Object.entries(analyzedScores)) merged[Number(k)] = v;
    return Object.entries(merged)
      .map(([m, lead]) => ({ move: Number(m), lead }))
      .sort((a, b) => a.move - b.move);
  }, [game, analyzedScores]);

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

  // KataGo analysis of the current position (opt-in). Browser models cancel the
  // stale search via the engine's 'interactive' group; the local backend is
  // canceled via the abort signal when scrubbing to a new position.
  useEffect(() => {
    if (!analyzeOn || !game) return;
    let active = true;
    const ctrl = new AbortController();
    const forCursor = cursor;
    const toPlay: Color =
      cursor < moves.length ? moves[cursor].color
        : cursor > 0 ? (moves[cursor - 1].color === 'B' ? 'W' : 'B')
          : 'B';
    const nextMove = cursor < moves.length ? moves[cursor] : null;
    const childStones = nextMove ? replay(moves.slice(0, cursor + 1)).stones : null;
    analyzePosition({
      model,
      stones: shown.stones,
      moves: moves.slice(0, cursor),
      toPlay,
      positionId: `${id}:${cursor}:${model.id}`,
      visits,
      signal: ctrl.signal,
      evalNext: nextMove && childStones ? { move: { x: nextMove.x, y: nextMove.y }, stones: childStones } : null,
      onProgress: (p) => {
        if (!active || !p.policyTop) return;
        const top = p.policyTop;
        // Keep the same object when unchanged so the board (and its spinner
        // animation) doesn't re-render on every progress tick.
        setPartialTop((prev) =>
          prev && prev.cursor === forCursor && prev.x === top.x && prev.y === top.y
            ? prev
            : { cursor: forCursor, x: top.x, y: top.y },
        );
      },
    })
      .then((res) => {
        if (!active || res === null) return;
        setAnalysis({ cursor: forCursor, data: res });
        setAnalyzedScores((s) => ({ ...s, [forCursor]: res.rootScoreLead }));
        setAnalysisErr('');
      })
      .catch((e) => {
        if (!active) return;
        setAnalysisErr(e instanceof Error ? e.message : 'analysis failed');
      });
    return () => { active = false; ctrl.abort(); };
  }, [analyzeOn, model, visits, game, id, moves, cursor, shown]);

  // Full-game score curve for the graph: one fast value pass over every position
  // when AI review is on (browser models only), filling in progressively.
  useEffect(() => {
    if (!analyzeOn || !game || model.kind !== 'browser') return;
    const ctrl = new AbortController();
    const boards: Stone[][] = [[]];
    let stones: Stone[] = [];
    let ko: { x: number; y: number } | null = null;
    for (let k = 0; k < total; k++) {
      const mv = moves[k];
      if (mv.x < 0 || mv.y < 0) { boards.push(stones); continue; } // pass
      const r = playMove(stones, mv.color, mv.x, mv.y, ko);
      if (!r.ok) { boards.push(stones); continue; }
      stones = r.stones; ko = r.koPoint;
      boards.push(stones);
    }
    const positions = boards.map((b, k) => ({
      stones: b,
      previousStones: k > 0 ? boards[k - 1] : undefined,
      previousPreviousStones: k > 1 ? boards[k - 2] : undefined,
      moves: moves.slice(0, k),
      toPlay: (k < total ? moves[k].color : k > 0 ? (moves[k - 1].color === 'B' ? 'W' : 'B') : 'B') as Color,
    }));
    scoreTrajectory({
      model,
      positions,
      komi: 7.5,
      onChunk: (from, scores) => {
        setAnalyzedScores((s) => {
          const next = { ...s };
          scores.forEach((v, j) => { next[from + j] = v; });
          return next;
        });
      },
      signal: ctrl.signal,
    }).catch(() => { /* aborted or transient engine error */ });
    return () => ctrl.abort();
  }, [analyzeOn, game, model, moves, total]);

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
  const outcome = gameOutcome(game, myUids);
  const seek = (m: number) => setCursor(Math.max(0, Math.min(total, m)));
  const when = new Date(game.createdAt).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
  const currentAnalysis = analyzeOn && analysis && analysis.cursor === cursor ? analysis.data : null;
  const running = analyzeOn && !currentAnalysis && !analysisErr;
  const showTop = running && partialTop && partialTop.cursor === cursor ? partialTop : null;
  const playedNext = cursor < total ? moves[cursor] : null;
  const aiCandidates = currentAnalysis
    ? [
        ...currentAnalysis.moves.map((m) => ({ x: m.x, y: m.y, loss: m.pointsLost })),
        // The played move gets its own dot when the search didn't already list it.
        ...(playedNext && currentAnalysis.playedEval
          && !currentAnalysis.moves.some((m) => m.x === playedNext.x && m.y === playedNext.y)
          ? [{ x: playedNext.x, y: playedNext.y, loss: currentAnalysis.playedEval.pointsLost }]
          : []),
      ]
    : undefined;

  return (
    <div className={`gr${outcome ? ` gr--${outcome}` : ''}`}>
      <div className="gr-head">
        <Link to="/review" className="gr-back">← Games</Link>
        <h1 className="gr-players">
          {info.playerBlack} <span className="gr-rank">[{info.rankBlack}]</span> vs.{' '}
          {info.playerWhite} <span className="gr-rank">[{info.rankWhite}]</span>
        </h1>
        <p className="gr-meta">
          {when}
          {game.myColor && game.ownerUid === user?.uid && <> · you played {game.myColor === 'B' ? 'Black' : 'White'}</>}
          {' · '}{total} moves
          {game.finalScore != null
            ? <> · final estimate <strong>{scoreLabel(game.finalScore)}</strong></>
            : info.result && (
              <> · <strong className={outcome ? `gr-result gr-result--${outcome}` : undefined}>{info.result}</strong></>
            )}
          {outcome && <span className={`gr-outcome gr-outcome--${outcome}`}>{outcome === 'win' ? 'You won' : 'You lost'}</span>}
        </p>
        <div className="gr-analyze-controls" ref={settingsRef}>
          <button
            type="button"
            className={analyzeOn ? 'gr-analyze-btn active' : 'gr-analyze-btn'}
            onClick={() => setAnalyzeOn((o) => !o)}
          >
            {analyzeOn ? 'AI review: on' : 'AI review'}
          </button>
          <button
            type="button"
            className="gr-gear"
            onClick={() => setSettingsOpen((o) => !o)}
            aria-label="Analysis settings"
            aria-expanded={settingsOpen}
          >
            ⚙
          </button>
          {settingsOpen && (
            <div className="gr-settings" role="menu">
              <div className="gr-settings-head">Model</div>
              {models.map((m) => (
                <label key={m.id} className={m.id === modelId ? 'gr-model active' : 'gr-model'}>
                  <input
                    type="radio"
                    name="katago-model"
                    checked={m.id === modelId}
                    onChange={() => setModelId(m.id)}
                  />
                  <span className="gr-model-main">
                    <span className="gr-model-name">{m.name}</span>
                    <span className="gr-model-sub">{m.runtime} · {m.strength}</span>
                  </span>
                  <input
                    type="number"
                    className="gr-model-visits"
                    min={1}
                    value={visitsByModel[m.id] ?? m.defaultVisits}
                    onChange={(e) =>
                      setVisitsByModel((v) => ({ ...v, [m.id]: Math.max(1, Math.floor(Number(e.target.value) || 1)) }))
                    }
                    aria-label={`${m.name} playouts`}
                  />
                  <span className="gr-model-visits-label">playouts</span>
                  {(visitsByModel[m.id] ?? m.defaultVisits) !== m.defaultVisits && (
                    <button
                      type="button"
                      className="gr-model-reset"
                      onClick={() => setVisitsByModel((v) => ({ ...v, [m.id]: m.defaultVisits }))}
                      title={`Reset to ${m.defaultVisits}`}
                      aria-label={`Reset ${m.name} playouts to default (${m.defaultVisits})`}
                    >
                      ↺
                    </button>
                  )}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {analyzeOn && <ScoreGraph points={points} total={total} cursor={cursor} onSeek={seek} />}

      <div className="gr-main">
        <div className="gr-board">
          <Board
            stones={shown.stones}
            annotations={annotations}
            aiCandidates={aiCandidates}
            spinnerAt={showTop ? { x: showTop.x, y: showTop.y } : null}
            ghostStone={playedNext ? { x: playedNext.x, y: playedNext.y, color: playedNext.color } : null}
          />
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
                    {' · '}{currentAnalysis.rootVisits}v
                    {playedNext && currentAnalysis.playedEval && (
                      <> · played {coordLabel(playedNext.x, playedNext.y)} (−{currentAnalysis.playedEval.pointsLost.toFixed(1)})</>
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
