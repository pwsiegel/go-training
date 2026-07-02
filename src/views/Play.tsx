import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Board, type Annotation } from '../Board';
import { playMove, replay, type PlayError } from '../goRules';
import type { Color } from '../types';
import { genmove } from '../data/katago';
import { saveGame } from '../data/games';
import { toSgf } from '../sgf';
import { useAuth } from '../auth';
import '../PlayView.css';
import './Play.css';

type Move = { color: Color; x: number; y: number };
type Phase = 'setup' | 'playing' | 'ended';
type ColorChoice = Color | 'random';

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

const OFFLINE_MSG = 'KataGo is offline — is `make api-katago` running?';

/** Play a full game against KataGo's human-like net at a chosen rank. The
 * opponent's move is sampled from KataGo's human policy (see the /genmove
 * backend), so it plays like a human of that rank. Local-dev only — reachable
 * when the backend runs with the analysis engine (`make api-katago`). Ending a
 * game offers to save it (to Firestore) and open the review page. */
export function Play() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();

  const [phase, setPhase] = useState<Phase>('setup');
  const [colorChoice, setColorChoice] = useState<ColorChoice>('B');
  const [rank, setRank] = useState('rank_9k');
  const [temperature, setTemperature] = useState(1.0);

  const [myColor, setMyColor] = useState<Color>('B');
  const [history, setHistory] = useState<Move[]>([]);
  const [score, setScore] = useState<number | null>(null);           // latest, Black's perspective
  const [scoreAt, setScoreAt] = useState<Record<string, number>>({}); // moveCount -> lead (Black)
  const [error, setError] = useState<string | null>(null);           // transient (illegal move)
  const [offline, setOffline] = useState(false);                     // engine unreachable
  const [retry, setRetry] = useState(0);                             // bump to re-request after offline
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { stones, koPoint } = useMemo(() => replay(history), [history]);
  const nextColor: Color = history.length % 2 === 0 ? 'B' : 'W';
  const opponentTurn = phase === 'playing' && nextColor !== myColor;
  const thinking = opponentTurn && !offline;
  const myTurn = phase === 'playing' && nextColor === myColor;
  const last = history.length ? history[history.length - 1] : null;
  const annotations: Annotation[] = last ? [{ kind: 'triangle', x: last.x, y: last.y }] : [];

  // Auto-clear transient (illegal-move) errors.
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 2200);
    return () => clearTimeout(t);
  }, [error]);

  // Opponent turn: fetch a human-net move and apply it. Records the strong-net
  // estimate of the position (after your move) for the review trajectory. Every
  // move KataGo returns is legal, so playMove here never rejects it.
  useEffect(() => {
    if (phase !== 'playing' || nextColor === myColor) return;
    const at = history.length;
    const ctrl = new AbortController();
    let active = true;
    genmove({ initialStones: [], moves: history, initialPlayer: 'B', rank, temperature, signal: ctrl.signal })
      .then((res) => {
        if (!active) return;
        const mv = res.move;
        setScore(res.root.score_lead);
        setScoreAt((prev) => ({ ...prev, [at]: res.root.score_lead }));
        setOffline(false);
        if (mv) setHistory((h) => [...h, { color: nextColor, x: mv.x, y: mv.y }]);
      })
      .catch(() => {
        if (active && !ctrl.signal.aborted) setOffline(true);
      });
    return () => { active = false; ctrl.abort(); };
  }, [phase, nextColor, myColor, history, rank, temperature, retry]);

  const start = () => {
    const resolved: Color = colorChoice === 'random'
      ? (Math.random() < 0.5 ? 'B' : 'W')
      : colorChoice;
    setMyColor(resolved);
    setHistory([]);
    setScore(null);
    setScoreAt({});
    setError(null);
    setOffline(false);
    setSaveError(null);
    setPhase('playing');
  };

  const handleCellClick = (x: number, y: number) => {
    if (!myTurn) return;
    const r = playMove(stones, nextColor, x, y, koPoint);
    if (!r.ok) { setError(ERROR_MESSAGES[r.error]); return; }
    setHistory((h) => [...h, { color: nextColor, x, y }]);
  };

  // Undo the last full exchange (your move + KataGo's reply) so it's your turn.
  const undo = () => {
    if (!myTurn || history.length < 2) return;
    setHistory((h) => h.slice(0, -2));
  };

  const reviewGame = async () => {
    if (!user || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
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
      const saved = await saveGame({
        ownerUid: user.uid,
        source: 'go-training',
        createdAt,
        myColor,
        rank,
        rankLabel,
        temperature,
        sgf,
        scoreAt,
        moveCount: history.length,
        finalScore: score,
      });
      navigate(`/review/${saved.id}`);
    } catch {
      setSaving(false);
      setSaveError('Could not save the game — is the games rule deployed? (make firebase-rules)');
    }
  };

  if (phase === 'setup') {
    return (
      <div className="play-page"><div className="play-setup">
        <h1>Play against KataGo</h1>
        <p className="play-setup-sub">
          A human-like opponent at the rank you choose. Runs on your local KataGo.
        </p>

        <div className="play-field">
          <span>Your color</span>
          <div className="play-seg" role="group" aria-label="Your color">
            {(['B', 'W', 'random'] as ColorChoice[]).map((c) => (
              <button
                key={c}
                type="button"
                className={colorChoice === c ? 'active' : ''}
                onClick={() => setColorChoice(c)}
              >
                {c === 'B' ? 'Black' : c === 'W' ? 'White' : 'Random'}
              </button>
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

        <button type="button" className="play-start" onClick={start}>Start game</button>
      </div></div>
    );
  }

  const opponentRank = RANKS.find((r) => r.value === rank)?.label ?? rank;
  const ended = phase === 'ended';
  const statusText = ended
    ? 'Game over'
    : thinking ? 'KataGo is thinking…' : `Your move (${myColor === 'B' ? 'Black' : 'White'})`;
  const scoreText = score === null ? null : `${score >= 0 ? 'B' : 'W'}+${Math.abs(score).toFixed(1)}`;

  return (
    <div className="play-page"><div className="play-view">
      <div className="play-board">
        <Board stones={stones} annotations={annotations} onCellClick={handleCellClick} />
        <div className="play-status">
          {error
            ? <span className="play-error">{error}</span>
            : offline
              ? <span className="play-error">{OFFLINE_MSG}</span>
              : <span>{statusText}</span>}
        </div>
        <div className="play-status">
          <span>
            You: {myColor === 'B' ? 'Black' : 'White'} · KataGo {opponentRank}
            {scoreText && <> · estimate <strong>{scoreText}</strong></>}
          </span>
        </div>
      </div>

      <div className="play-tools" role="toolbar" aria-label="Play controls">
        {ended ? (
          <>
            <p className="play-ended-note">{history.length} moves played.</p>
            <button type="button" className="play-tool play-tool-primary" onClick={reviewGame} disabled={saving}>
              {saving ? 'Saving…' : 'Review this game'}
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
            <button type="button" className="play-tool" onClick={undo} disabled={!myTurn || history.length < 2}>
              Undo
            </button>
            <button type="button" className="play-tool" onClick={() => setPhase('ended')}>End game</button>
            <div className="play-tools-divider" />
            <span className="play-movecount">{history.length} moves</span>
          </>
        )}
      </div>
    </div></div>
  );
}
