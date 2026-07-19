import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Board, type Annotation } from '../Board';
import { playMove, type PlayError } from '../goRules';
import type { Color, Stone } from '../types';
import { analyzePosition } from '../katago/webEngine';
import { useModelPreference } from '../katago/useModelPreference';
import { useEngineLease } from '../katago/engineLease';
import { listAiProblems, difficultyLabel, type AiProblem } from '../data/aiTsumego';
import './AiTsumego.css';

const REPLY_VISITS = 50;

const ERROR_MESSAGES: Record<PlayError, string> = {
  occupied: 'Occupied.',
  suicide: 'Suicide is not allowed.',
  ko: 'Ko: cannot play there yet.',
  'out-of-bounds': 'Out of bounds.',
};

const toStones = (p: AiProblem): Stone[] =>
  p.stones.map((s) => ({ x: s.col, y: s.row, color: s.color as Color }));

/** Experimental testing surface for AI-generated whole-board tsumego: assess
 * the marked group's status (alive/dead), then prove it by playing against the
 * analysis engine. No solution trees — the engine responds with its best move
 * and the score readout tracks the exchange. */
export function AiTsumegoList() {
  const [problems, setProblems] = useState<AiProblem[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    listAiProblems().then(setProblems).catch(() => setErr('Could not load the AI collection.'));
  }, []);
  return (
    <div className="aits-page">
      <h1>AI tsumego</h1>
      <p className="aits-sub">
        Experimental whole-board problems mined from pro games. Decide whether the
        marked group is alive or dead, then prove it against the AI.
      </p>
      {err && <p className="aits-error">{err}</p>}
      {!problems && !err && <p>Loading…</p>}
      <div className="aits-grid">
        {problems?.map((p, i) => (
          <Link key={p.id} to={`/ai-tsumego/${p.id}`} className="aits-card">
            <Board stones={toStones(p)} thumbnail />
            <div className="aits-card-meta">
              <span className="aits-card-num">#{i + 1}</span>
              <span className="aits-card-diff">{difficultyLabel(p.gen.difficulty)}</span>
              <span>{p.black_to_play ? 'Black' : 'White'} to play</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

type Snap = { stones: Stone[]; koPoint: { x: number; y: number } | null };

export function AiTsumegoSolve() {
  const { id } = useParams<{ id: string }>();
  const [problem, setProblem] = useState<AiProblem | null>(null);
  const [missing, setMissing] = useState(false);
  const { model } = useModelPreference();

  const [claim, setClaim] = useState<'alive' | 'dead' | null>(null);
  // Snapshots per ply; the last entry is the current position.
  const [snaps, setSnaps] = useState<Snap[]>([]);
  const [thinking, setThinking] = useState(false);
  const [score, setScore] = useState<number | null>(null);   // Black lead
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [engineErr, setEngineErr] = useState(false);
  const seq = useRef(0);   // invalidates in-flight replies on undo/reset

  useEffect(() => {
    listAiProblems().then((ps) => {
      const p = ps.find((x) => x.id === id) ?? null;
      setProblem(p);
      setMissing(!p);
      if (p) setSnaps([{ stones: toStones(p), koPoint: null }]);
    }).catch(() => setMissing(true));
  }, [id]);

  const playing = claim !== null;
  const engineStatus = useEngineLease(playing && model.kind === 'browser');

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 2200);
    return () => clearTimeout(t);
  }, [error]);

  const cur = snaps[snaps.length - 1];
  const myColor: Color = problem?.black_to_play ? 'B' : 'W';
  const engineColor: Color = myColor === 'B' ? 'W' : 'B';
  const plies = snaps.length - 1;
  const myTurn = playing && !thinking && plies % 2 === 0;

  const target = problem?.gen.target;
  // Mark the original chain points that still hold a stone of the target color.
  const annotations: Annotation[] = useMemo(() => {
    if (!target || !cur) return [];
    const occ = new Set(cur.stones.filter((s) => s.color === target.color).map((s) => `${s.x},${s.y}`));
    return target.chain
      .filter(([x, y]) => occ.has(`${x},${y}`))
      .map(([x, y]) => ({ kind: 'triangle', x, y }));
  }, [target, cur]);
  const capturedCount = target && cur
    ? target.chain.length - annotations.length
    : 0;
  const captured = !!target && annotations.length === 0;

  // Moves played so far, reconstructed from the snapshots (each ply adds
  // exactly one stone) — the engine wants them for its history planes.
  const movesFrom = (ss: Snap[]) => {
    const out: { color: Color; x: number; y: number }[] = [];
    for (let i = 1; i < ss.length; i++) {
      const prevSet = new Set(ss[i - 1].stones.map((s) => `${s.x},${s.y},${s.color}`));
      const added = ss[i].stones.find((s) => !prevSet.has(`${s.x},${s.y},${s.color}`));
      if (added) out.push({ color: added.color, x: added.x, y: added.y });
    }
    return out;
  };

  const engineReply = async (afterSnaps: Snap[]) => {
    const mySeq = ++seq.current;
    setThinking(true);
    setEngineErr(false);
    try {
      const pos = afterSnaps[afterSnaps.length - 1];
      const analysis = await analyzePosition({
        model,
        stones: pos.stones,
        previousStones: afterSnaps[afterSnaps.length - 2]?.stones,
        previousPreviousStones: afterSnaps[afterSnaps.length - 3]?.stones,
        moves: movesFrom(afterSnaps),
        toPlay: engineColor,
        positionId: `${id}:${afterSnaps.length}:${mySeq}`,
        visits: REPLY_VISITS,
      });
      if (mySeq !== seq.current || !analysis) return;
      setScore(analysis.rootScoreLead);
      const best = analysis.moves[0];
      if (!best) return;   // engine passes (resolved position)
      const r = playMove(pos.stones, engineColor, best.x, best.y, pos.koPoint);
      if (!r.ok) return;
      setSnaps([...afterSnaps, { stones: r.stones, koPoint: r.koPoint }]);
    } catch {
      if (mySeq === seq.current) setEngineErr(true);
    } finally {
      if (mySeq === seq.current) setThinking(false);
    }
  };

  const handleCellClick = (x: number, y: number) => {
    if (!myTurn || !cur) return;
    if (model.kind === 'browser' && engineStatus !== 'active') return;
    const r = playMove(cur.stones, myColor, x, y, cur.koPoint);
    if (!r.ok) { setError(ERROR_MESSAGES[r.error]); return; }
    const next = [...snaps, { stones: r.stones, koPoint: r.koPoint }];
    setSnaps(next);
    void engineReply(next);
  };

  const undo = () => {
    seq.current += 1;
    setThinking(false);
    // Drop back to the previous position where it was your turn.
    const back = plies % 2 === 0 ? 2 : 1;
    setSnaps((s) => s.slice(0, Math.max(1, s.length - back)));
  };

  const reset = () => {
    seq.current += 1;
    setThinking(false);
    setClaim(null);
    setScore(null);
    setRevealed(false);
    if (problem) setSnaps([{ stones: toStones(problem), koPoint: null }]);
  };

  if (missing) {
    return <div className="aits-page"><p>Problem not found. <Link to="/ai-tsumego">Back to AI tsumego</Link></p></div>;
  }
  if (!problem || !cur) return <div className="aits-page"><p>Loading…</p></div>;

  const gen = problem.gen;
  const claimCorrect = claim !== null && claim === gen.target.verdict;
  const scoreText = score === null ? null : `${score >= 0 ? 'B' : 'W'}+${Math.abs(score).toFixed(1)}`;
  const startText = `${gen.score_black >= 0 ? 'B' : 'W'}+${Math.abs(gen.score_black).toFixed(1)}`;

  return (
    <div className="aits-page"><div className="aits-solve">
      <div className="aits-board">
        {!playing && (
          <div className="aits-prompt">
            Is the marked {gen.target.color === 'B' ? 'Black' : 'White'} group{' '}
            <strong>alive or dead</strong> with {problem.black_to_play ? 'Black' : 'White'} to play?
            <div className="aits-claim">
              <button type="button" onClick={() => setClaim('alive')}>Alive</button>
              <button type="button" onClick={() => setClaim('dead')}>Dead</button>
            </div>
          </div>
        )}
        {playing && (
          <div className="aits-prompt aits-prompt-play">
            You claimed the group is <strong>{claim}</strong> — prove it.
            {captured && <span className="aits-captured"> The marked group has been captured.</span>}
          </div>
        )}
        {playing && model.kind === 'browser' && engineStatus === 'waiting' && (
          <div className="aits-blocked">
            KataGo AI is running in another tab or window — close it to play here.
          </div>
        )}

        <Board stones={cur.stones} annotations={annotations} onCellClick={handleCellClick} />

        <div className="aits-status">
          {error ? <span className="aits-error">{error}</span>
            : engineErr ? <span className="aits-error">Engine error — try Undo or Reset.</span>
              : !playing ? <span>Assess the position first.</span>
                : thinking ? <span>AI is thinking…</span>
                  : <span>Your move ({myColor === 'B' ? 'Black' : 'White'}) · {plies} moves played
                    {capturedCount > 0 && !captured && ` · ${capturedCount} marked stones captured`}</span>}
        </div>
        <div className="aits-status">
          <span>
            Start estimate <strong>{startText}</strong>
            {scoreText && <> · now <strong>{scoreText}</strong></>}
            {' '}· engine {model.name} @ {REPLY_VISITS} visits
          </span>
        </div>
      </div>

      <div className="aits-tools">
        <Link to="/ai-tsumego" className="aits-tool">← All problems</Link>
        <button type="button" className="aits-tool" onClick={undo} disabled={plies === 0}>Undo</button>
        <button type="button" className="aits-tool" onClick={reset}>Reset</button>
        <button type="button" className="aits-tool" onClick={() => setRevealed(true)} disabled={revealed}>
          Reveal answer
        </button>
        {revealed && (
          <div className="aits-reveal">
            <p>
              The marked group is <strong>{gen.target.verdict}</strong>
              {claim !== null && <> — your claim was <strong>{claimCorrect ? 'correct' : 'wrong'}</strong></>}.
            </p>
            <p>Best move <strong>{gen.best_move}</strong>; good moves: {gen.good_moves.join(', ') || '—'}.</p>
            <p>
              Difficulty <strong>{difficultyLabel(gen.difficulty)}</strong> (weakest rank whose
              policy keeps the verdict). Ownership: cheap {gen.target.own_cheap},
              converged {gen.target.own_converged}, after tenuki {gen.target.own_after_tenuki}.
            </p>
            <p className="aits-provenance">
              From {gen.source_game} @ move {gen.pro_turn}, +{gen.mined_at_ply - gen.pro_turn} plies
              of {gen.sim_rank.replace('rank_', '')} continuation.
            </p>
          </div>
        )}
      </div>
    </div></div>
  );
}
