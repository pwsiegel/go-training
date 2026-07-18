import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Board, type Annotation } from '../Board';
import { playMove, replay, type PlayError } from '../goRules';
import type { Color } from '../types';
import { genmoveBrowser } from '../katago/webEngine';
import { useEngineLease } from '../katago/engineLease';
import { genmove, katagoBackendAvailable } from '../data/katago';
import { saveGame } from '../data/games';
import { setPlayDefaults } from '../data/profile';
import type { GameDoc } from '../data/model';
import { toSgf } from '../sgf';
import { useAuth } from '../auth';
import { ScoreGraph } from '../ScoreGraph';
import '../PlayView.css';
import './Play.css';

type Move = { color: Color; x: number; y: number };
type Phase = 'setup' | 'playing' | 'ended';
type ColorChoice = Color | 'random';
type ScoreMode = 'show' | 'hide' | 'alert';
type AlertKind = 'behind' | 'drop';

const ERROR_MESSAGES: Record<PlayError, string> = {
  occupied: 'Occupied.',
  suicide: 'Suicide is not allowed.',
  ko: 'Ko: cannot play there yet.',
  'out-of-bounds': 'Out of bounds.',
};

const RANKS: { value: string; label: string }[] = [
  ...[18, 15, 12, 10, 8, 6, 5, 4, 3, 2, 1].map((k) => ({ value: `rank_${k}k`, label: `${k} kyu` })),
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => ({ value: `rank_${d}d`, label: `${d} dan` })),
];

const ENGINES: { id: 'browser' | 'local'; name: string; runtime: string }[] = [
  { id: 'browser', name: 'b18c384nbt-humanv0', runtime: 'WebGPU' },
  { id: 'local', name: 'b18c384nbt-humanv0', runtime: 'Metal (native)' },
];

const OFFLINE_MSG = 'Could not run KataGo — your browser may not support WebGPU, or the model failed to load.';

// The ~100MB human net loads on the first browser move; show "Model loading"
// until then. Module-level so it survives remounts (the worker caches the net).
let humanNetWarmed = false;

/** Play a full game against KataGo's human-like net at a chosen rank. The
 * opponent's move is sampled from the human net's rank-conditioned policy,
 * running entirely in the browser (WebGPU) — no backend. You can rewind and
 * resume from an earlier position, tune the score display, and change any
 * setting mid-game. Ending a game offers to review and/or save it. */
export function Play() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();

  const [phase, setPhase] = useState<Phase>('setup');
  const [colorChoice, setColorChoice] = useState<ColorChoice>('B');
  const [rank, setRank] = useState('rank_9k');
  const [temperature, setTemperature] = useState(1.0);
  const [engine, setEngine] = useState<'browser' | 'local'>('browser');
  const [localAvailable, setLocalAvailable] = useState(false);
  const [scoreMode, setScoreMode] = useState<ScoreMode>('show');
  const [alertKind, setAlertKind] = useState<AlertKind>('behind');
  const [alertThreshold, setAlertThreshold] = useState(5);
  const [dropPoints, setDropPoints] = useState(5);
  const [dropMoves, setDropMoves] = useState(10);
  const [moveDelay, setMoveDelay] = useState(1);   // seconds of minimum "think time"
  const [warmed, setWarmed] = useState(humanNetWarmed);
  // Hold the browser-engine lease while a browser game is in progress; only one
  // tab/window may drive the GPU at a time. The native engine needs no lease.
  const engineStatus = useEngineLease(phase === 'playing' && engine === 'browser');

  const [myColor, setMyColor] = useState<Color>('B');
  const [history, setHistory] = useState<Move[]>([]);
  const [mainline, setMainline] = useState<Move[]>([]);               // moves as originally played, for replay
  const [viewing, setViewing] = useState<number | null>(null);        // null = live end
  const [scoreAt, setScoreAt] = useState<Record<string, number>>({}); // moveCount -> lead (Black)
  const [alerted, setAlerted] = useState(false);                      // graph revealed after first alert
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);            // transient (illegal move)
  const [offline, setOffline] = useState(false);                      // engine unreachable
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Seed the setup form from the user's last-used settings once the profile
  // loads (before their first game); after that, local state is authoritative.
  const seededDefaults = useRef(false);
  useEffect(() => {
    const d = profile?.playDefaults;
    if (seededDefaults.current || !d || phase !== 'setup') return;
    seededDefaults.current = true;
    setColorChoice(d.colorChoice);
    setRank(d.rank);
    setTemperature(d.temperature);
    setMoveDelay(d.moveDelay);
    setScoreMode(d.scoreMode);
    setAlertThreshold(d.alertThreshold);
    setAlertKind(d.alertKind ?? 'behind');
    setDropPoints(d.dropPoints ?? 5);
    setDropMoves(d.dropMoves ?? 10);
  }, [profile, phase]);

  const atLive = viewing === null;
  const viewIndex = viewing ?? history.length;
  const viewMoves = useMemo(() => (atLive ? history : history.slice(0, viewing!)), [atLive, history, viewing]);
  const { stones, koPoint } = useMemo(() => replay(viewMoves), [viewMoves]);
  const playPoints = useMemo(
    () => Object.entries(scoreAt).map(([m, v]) => ({ move: Number(m), lead: v })).sort((a, b) => a.move - b.move),
    [scoreAt],
  );
  // Most recent recorded estimate at or before move n (Black lead).
  const scoreAtMove = (n: number): number | null => {
    let best: number | null = null;
    let bestMove = -1;
    for (const [mc, v] of Object.entries(scoreAt)) {
      const m = Number(mc);
      if (m <= n && m > bestMove) { bestMove = m; best = v; }
    }
    return best;
  };
  const viewScore = scoreAtMove(viewIndex);
  // On the original line (a prefix of the recorded mainline): the AI replays its
  // recorded moves until you play something that diverges.
  const onMainline = mainline.length > history.length
    && history.every((m, i) => m.x === mainline[i].x && m.y === mainline[i].y && m.color === mainline[i].color);
  const liveNextColor: Color = history.length % 2 === 0 ? 'B' : 'W';
  const opponentTurn = phase === 'playing' && atLive && liveNextColor !== myColor;
  const thinking = opponentTurn && !offline;
  const myTurn = phase === 'playing' && atLive && liveNextColor === myColor;
  const last = viewMoves.length ? viewMoves[viewMoves.length - 1] : null;
  const annotations: Annotation[] = last ? [{ kind: 'triangle', x: last.x, y: last.y }] : [];

  // Score from your perspective at the live position (positive = you're ahead).
  const liveScore = scoreAtMove(history.length);
  const userLead = liveScore === null ? null : (myColor === 'B' ? liveScore : -liveScore);
  const behindBy = userLead === null ? null : -userLead;
  // Points lost from your perspective between `dropMoves` ago and now (null
  // until an estimate that old exists).
  const baseline = scoreAtMove(Math.max(0, history.length - dropMoves));
  const baselineLead = baseline === null ? null : (myColor === 'B' ? baseline : -baseline);
  const droppedBy = userLead === null || baselineLead === null ? null : baselineLead - userLead;
  const alerting = scoreMode === 'alert' && (alertKind === 'behind'
    ? behindBy !== null && behindBy >= alertThreshold
    : droppedBy !== null && droppedBy >= dropPoints);
  // Reveal the graph the first time the alert fires; keep it up afterwards.
  if (alerting && !alerted) setAlerted(true);
  const showGraph = scoreMode === 'alert' && alerted;

  // Auto-clear transient (illegal-move) errors.
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 2200);
    return () => clearTimeout(t);
  }, [error]);

  // Offer the native backend as an engine choice only when it's reachable (dev).
  useEffect(() => {
    let active = true;
    katagoBackendAvailable().then((ok) => { if (active) setLocalAvailable(ok); });
    return () => { active = false; };
  }, []);

  // Left/right arrows scrub through moves (skip when typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phase === 'setup') return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') setViewing((v) => Math.max(0, (v ?? history.length) - 1));
      else if (e.key === 'ArrowRight') setViewing((v) => { const n = (v ?? history.length) + 1; return n >= history.length ? null : n; });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, history.length]);

  // Opponent turn (only at the live end): fetch a human-net move + score and
  // apply it. Every move KataGo returns is legal, so playMove never rejects it.
  useEffect(() => {
    if (phase !== 'playing' || !atLive || liveNextColor === myColor) return;
    const at = history.length;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // Re-walking the original line: replay the recorded AI move (after the same
    // delay) instead of sampling a fresh one.
    if (onMainline) {
      timer = setTimeout(() => {
        if (!active) return;
        setHistory(mainline.slice(0, at + 1));
        setOffline(false);
      }, moveDelay * 1000);
      return () => { active = false; if (timer) clearTimeout(timer); };
    }

    // Wait for the browser-engine lease before sampling a move (a banner tells
    // the user another tab/window holds it). Re-runs when the lease is granted.
    if (engine === 'browser' && engineStatus !== 'active') return () => { active = false; };

    const ctrl = new AbortController();
    const startedAt = Date.now();
    const gen = engine === 'local'
      ? genmove({ initialStones: [], moves: history, initialPlayer: 'B', rank, temperature, signal: ctrl.signal })
          .then((r) => ({ move: r.move, scoreLead: r.root.score_lead }))
      : genmoveBrowser({
          stones,
          previousStones: replay(history.slice(0, -1)).stones,
          moves: history,
          toPlay: liveNextColor,
          rank,
          temperature,
          komi: 7.5,
          koPoint,
        });
    gen
      .then((res) => {
        if (!active) return;
        // Minimum "think time" so the reply doesn't snap in instantly.
        const wait = Math.max(0, moveDelay * 1000 - (Date.now() - startedAt));
        timer = setTimeout(() => {
          if (!active) return;
          if (engine === 'browser' && !humanNetWarmed) { humanNetWarmed = true; setWarmed(true); }
          setScoreAt((prev) => ({ ...prev, [at]: res.scoreLead }));
          setOffline(false);
          if (res.move) {
            const nh = [...history, { color: liveNextColor, x: res.move!.x, y: res.move!.y }];
            setHistory(nh);
            setMainline(nh);   // a fresh reply extends / becomes the mainline
          }
        }, wait);
      })
      .catch(() => {
        if (active && !ctrl.signal.aborted) setOffline(true);
      });
    return () => { active = false; ctrl.abort(); if (timer) clearTimeout(timer); };
  }, [phase, atLive, liveNextColor, myColor, history, mainline, onMainline, stones, koPoint, rank, temperature, engine, engineStatus, moveDelay, retry]);

  const start = () => {
    const resolved: Color = colorChoice === 'random'
      ? (Math.random() < 0.5 ? 'B' : 'W')
      : colorChoice;
    if (user) {
      void setPlayDefaults(user.uid, {
        colorChoice, rank, temperature, moveDelay, scoreMode, alertKind, alertThreshold, dropPoints, dropMoves,
      }).catch(() => {});   // best-effort: a failed default-save shouldn't block play
    }
    setMyColor(resolved);
    setHistory([]);
    setMainline([]);
    setViewing(null);
    setScoreAt({});
    setAlerted(false);
    setError(null);
    setOffline(false);
    setSaveError(null);
    setSaved(false);
    setSettingsOpen(false);
    setPhase('playing');
  };

  const handleCellClick = (x: number, y: number) => {
    if (!myTurn) return;
    const r = playMove(stones, myColor, x, y, koPoint);
    if (!r.ok) { setError(ERROR_MESSAGES[r.error]); return; }
    const at = history.length;
    const orig = onMainline ? mainline[at] : undefined;
    if (orig && orig.x === x && orig.y === y && orig.color === myColor) {
      setHistory(mainline.slice(0, at + 1));   // replaying your original move — stay on the line
    } else {
      const nh = [...history, { color: myColor, x, y }];
      setHistory(nh);
      setMainline(nh);   // you diverged — this becomes the new mainline
      setScoreAt((s) => Object.fromEntries(Object.entries(s).filter(([mc]) => Number(mc) <= at)));
    }
  };

  // Rewind / advance the viewed position (null = live end).
  const seek = (n: number) => setViewing(n >= history.length ? null : Math.max(0, n));

  // Truncate the game to the rewound position and resume live play from there.
  const continueFromHere = () => {
    if (viewing === null) return;
    setMainline(history);          // keep the current line so the AI replays it
    setHistory(history.slice(0, viewing));
    // scoreAt is kept — the recorded future scores are reused while re-walking.
    setAlerted(false);             // hide the alert graph until you fall behind again
    setViewing(null);
    setSaved(false);
    setPhase('playing');
  };

  // The completed game as a GameDoc (sans id) — used both to persist and to hand
  // straight to the review UI without saving.
  const buildGameDoc = (): Omit<GameDoc, 'id'> => {
    const rankLabel = RANKS.find((r) => r.value === rank)?.label ?? rank;
    const rankShort = rank.replace('rank_', '');   // "9k" / "1d"
    const myName = profile?.displayName || 'Me';
    const oppName = 'Human-like KataGo';
    const black = myColor === 'B';
    const createdAt = Date.now();
    const sgf = toSgf(history, {
      komi: 7.5,
      rules: 'Chinese',
      playerBlack: black ? myName : oppName,
      playerWhite: black ? oppName : myName,
      rankBlack: black ? '?' : rankShort,
      rankWhite: black ? rankShort : '?',
      date: new Date(createdAt).toISOString().slice(0, 10),
    });
    return {
      ownerUid: user?.uid ?? '',
      source: 'go-training',
      createdAt,
      myColor,
      rank,
      rankLabel,
      temperature,
      sgf,
      scoreAt,
      moveCount: history.length,
      finalScore: scoreAtMove(history.length),
    };
  };

  const save = async () => {
    if (!user || saving || saved) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveGame(buildGameDoc());
      setSaved(true);
    } catch {
      setSaveError('Could not save the game — is the games rule deployed? (make firebase-rules)');
    } finally {
      setSaving(false);
    }
  };

  // Review the just-played game in the shared review UI without persisting it.
  const review = () => {
    navigate('/review/preview', { state: { game: { ...buildGameDoc(), id: 'preview' } satisfies GameDoc } });
  };

  // The settings form, reused in the setup screen and the in-game drawer.
  const renderSettings = (inGame: boolean) => (
    <>
      <div className="play-field">
        <span>Your color</span>
        <div className="play-seg" role="group" aria-label="Your color">
          {(inGame ? (['B', 'W'] as ColorChoice[]) : (['B', 'W', 'random'] as ColorChoice[])).map((c) => (
            <button
              key={c}
              type="button"
              className={(inGame ? myColor : colorChoice) === c ? 'active' : ''}
              onClick={() => (inGame ? setMyColor(c as Color) : setColorChoice(c))}
            >
              {c === 'B' ? 'Black' : c === 'W' ? 'White' : 'Random'}
            </button>
          ))}
        </div>
      </div>

      <div className="play-field">
        <span>Model</span>
        <div className="play-engines">
          {ENGINES.filter((e) => e.id === 'browser' || localAvailable).map((e) => (
            <label key={e.id} className={engine === e.id ? 'play-engine active' : 'play-engine'}>
              <input type="radio" name="play-engine" checked={engine === e.id} onChange={() => setEngine(e.id)} />
              <span className="play-engine-main">
                <span className="play-engine-name">{e.name}</span>
                <span className="play-engine-sub">{e.runtime}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <label className="play-field">
        <span>Opponent rank</span>
        <select value={rank} onChange={(e) => setRank(e.target.value)}>
          {RANKS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </label>

      <label className="play-field">
        <span>Sharpness <small>{temperature.toFixed(2)}</small></span>
        <input
          type="range" min={0.2} max={1.0} step={0.05}
          value={temperature}
          onChange={(e) => setTemperature(Number(e.target.value))}
        />
        <small className="play-hint">1.0 plays like the rank; lower is sharper and stronger.</small>
      </label>

      <label className="play-field">
        <span>Move delay <small>{moveDelay.toFixed(2)}s</small></span>
        <input
          type="range" min={0} max={3} step={0.25}
          value={moveDelay}
          onChange={(e) => setMoveDelay(Number(e.target.value))}
        />
        <small className="play-hint">Minimum pause before the AI plays its reply.</small>
      </label>

      <div className="play-field">
        <span>Score</span>
        <div className="play-seg" role="group" aria-label="Score display">
          {(['show', 'hide', 'alert'] as ScoreMode[]).map((m) => (
            <button key={m} type="button" className={scoreMode === m ? 'active' : ''} onClick={() => setScoreMode(m)}>
              {m === 'show' ? 'Show' : m === 'hide' ? 'Hide' : 'Alert'}
            </button>
          ))}
        </div>
        {scoreMode === 'alert' && (
          <>
            <label className="play-alert-thresh">
              <input type="radio" name="alert-kind" checked={alertKind === 'behind'} onChange={() => setAlertKind('behind')} />
              Alert when behind by{' '}
              <input
                type="number" min={1}
                value={alertThreshold}
                onChange={(e) => setAlertThreshold(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
              />{' '}points.
            </label>
            <label className="play-alert-thresh">
              <input type="radio" name="alert-kind" checked={alertKind === 'drop'} onChange={() => setAlertKind('drop')} />
              Alert when{' '}
              <input
                type="number" min={1}
                value={dropPoints}
                onChange={(e) => setDropPoints(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
              />{' '}points are lost over the last{' '}
              <input
                type="number" min={2}
                value={dropMoves}
                onChange={(e) => setDropMoves(Math.max(2, Math.floor(Number(e.target.value) || 2)))}
              />{' '}moves.
            </label>
          </>
        )}
      </div>
    </>
  );

  if (phase === 'setup') {
    return (
      <div className="play-page"><div className="play-setup">
        <h1>Play against KataGo</h1>
        <p className="play-setup-sub">
          A human-like opponent at the rank you choose. Runs entirely in your browser.
        </p>
        {renderSettings(false)}
        <button type="button" className="play-start" onClick={start}>Start game</button>
      </div></div>
    );
  }

  const opponentRank = RANKS.find((r) => r.value === rank)?.label ?? rank;
  const ended = phase === 'ended';
  const statusText = ended
    ? 'Game over'
    : !atLive ? 'Reviewing an earlier position'
      : thinking ? (
        engine === 'browser' && engineStatus === 'waiting' ? 'Waiting for another window…'
          : engine === 'browser' && !warmed ? 'Model loading…'
            : 'KataGo is thinking…')
        : `Your move (${myColor === 'B' ? 'Black' : 'White'})`;
  const scoreText = viewScore === null ? null : `${viewScore >= 0 ? 'B' : 'W'}+${Math.abs(viewScore).toFixed(1)}`;

  return (
    <div className="play-page"><div className="play-view">
      <div className="play-board">
        {alerting && (
          <div className="play-alert">
            {alertKind === 'behind'
              ? <>You're behind by {behindBy!.toFixed(1)} points — rewind on the graph and try a different line.</>
              : <>You've lost {droppedBy!.toFixed(1)} points over the last {dropMoves} moves — rewind on the graph and try a different line.</>}
          </div>
        )}
        {engineStatus === 'waiting' && (
          <div className="play-blocked">
            KataGo AI is running in another tab or window — turn it off there (or close it) to play here.
          </div>
        )}
        {showGraph && (
          <ScoreGraph points={playPoints} total={history.length} cursor={viewIndex} onSeek={seek} />
        )}
        {showGraph && !atLive && (
          <button type="button" className="play-continue play-continue-graph" onClick={continueFromHere}>Continue from here</button>
        )}

        <Board stones={stones} annotations={annotations} onCellClick={handleCellClick} />

        <div className="play-scrub">
          <button type="button" onClick={() => seek(0)} disabled={viewIndex === 0} aria-label="Start">⏮</button>
          <button type="button" onClick={() => seek(viewIndex - 1)} disabled={viewIndex === 0} aria-label="Back">◀</button>
          <span className="play-scrub-pos">{viewIndex} / {history.length}</span>
          <button type="button" onClick={() => seek(viewIndex + 1)} disabled={atLive} aria-label="Forward">▶</button>
          <button type="button" onClick={() => seek(history.length)} disabled={atLive} aria-label="Live">⏭</button>
          {!atLive && !showGraph && (
            <button type="button" className="play-continue" onClick={continueFromHere}>Continue from here</button>
          )}
        </div>

        <div className="play-status">
          {error
            ? <span className="play-error">{error}</span>
            : offline
              ? <span className="play-error">{engine === 'local' ? 'KataGo backend offline — is `make api` running?' : OFFLINE_MSG}</span>
              : <span>{statusText}</span>}
        </div>
        <div className="play-status">
          <span>
            You: {myColor === 'B' ? 'Black' : 'White'} · KataGo {opponentRank}
            {scoreMode === 'show' && scoreText && <> · estimate <strong>{scoreText}</strong></>}
          </span>
        </div>
      </div>

      <div className="play-tools" role="toolbar" aria-label="Play controls">
        {ended ? (
          <>
            <p className="play-ended-note">{history.length} moves played.</p>
            <button type="button" className="play-tool play-tool-primary" onClick={review}>Review</button>
            <button type="button" className="play-tool" onClick={save} disabled={saving || saved || !user}>
              {saved ? 'Saved ✓' : saving ? 'Saving…' : 'Save game'}
            </button>
            {saveError && <span className="play-error">{saveError}</span>}
            <button type="button" className="play-tool" onClick={() => setPhase('playing')}>Keep playing</button>
            <button type="button" className="play-tool" onClick={() => setPhase('setup')}>Discard &amp; new game</button>
          </>
        ) : (
          <>
            {offline && (
              <button type="button" className="play-tool" onClick={() => { setOffline(false); setRetry((n) => n + 1); }}>
                Retry
              </button>
            )}
            <button type="button" className="play-tool" onClick={() => setSettingsOpen(true)}>⚙ Settings</button>
            <button type="button" className="play-tool" onClick={() => { setSaved(false); setSaveError(null); setPhase('ended'); }}>End game</button>
            <div className="play-tools-divider" />
            <span className="play-movecount">{history.length} moves</span>
          </>
        )}
      </div>

      {settingsOpen && (
        <div className="play-drawer-backdrop" onClick={() => setSettingsOpen(false)}>
          <div className="play-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="play-drawer-head">
              <span>Settings</span>
              <button type="button" className="play-drawer-close" onClick={() => setSettingsOpen(false)} aria-label="Close">×</button>
            </div>
            {renderSettings(true)}
          </div>
        </div>
      )}
    </div></div>
  );
}
