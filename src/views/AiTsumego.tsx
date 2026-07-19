import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Board, type Annotation } from '../Board';
import { playMove } from '../goRules';
import type { Color, Stone } from '../types';
import { analyzePosition } from '../katago/webEngine';
import { useEngineHub } from '../katago/engineHub';
import { listAiProblems, difficultyLabel, type AiProblem } from '../data/aiTsumego';
import './AiTsumego.css';

const REPLY_VISITS = 50;
// Judged from the engine-turn analysis (the claim's falsifier to move): the
// group's mean ownership beyond this, in either direction, settles the claim.
const JUDGE_DECIDED = 0.8;
const JUDGE_MIN_PLIES = 2;   // let the user actually play before judging

const other = (c: Color): Color => (c === 'B' ? 'W' : 'B');

const toStones = (p: AiProblem): Stone[] =>
  p.stones.map((s) => ({ x: s.col, y: s.row, color: s.color as Color }));

/** Experimental testing surface for AI-generated whole-board tsumego: assess
 * the marked group's status (alive/dead), then prove it by playing against the
 * analysis engine. Your claim picks your side — alive defends the group, dead
 * attacks it — and the engine plays the other side. */
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
  const { model, engineReady, leaseStatus, health } = useEngineHub();

  const [claim, setClaim] = useState<'alive' | 'dead' | null>(null);
  // Snapshots per ply; the last entry is the current position.
  const [snaps, setSnaps] = useState<Snap[]>([]);
  const [thinking, setThinking] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [engineErr, setEngineErr] = useState(false);
  // Set once the claim is settled: proved (claim demonstrated) or failed.
  const [outcome, setOutcome] = useState<{ result: 'proved' | 'failed'; pointsLost: number | null } | null>(null);
  // TEMP debug: last judge measurement, rendered in the banner.
  const [judgeDebug, setJudgeDebug] = useState<string>('');
  const [replyTick, setReplyTick] = useState(0);   // bumps to re-attempt a canceled reply
  const retries = useRef(0);
  const seq = useRef(0);        // invalidates in-flight replies on undo/reset
  const inFlight = useRef(false);

  useEffect(() => {
    listAiProblems().then((ps) => {
      const p = ps.find((x) => x.id === id) ?? null;
      setProblem(p);
      setMissing(!p);
      if (p) setSnaps([{ stones: toStones(p), koPoint: null }]);
    }).catch(() => setMissing(true));
  }, [id]);

  const playing = claim !== null;

  const cur = snaps[snaps.length - 1];
  const target = problem?.gen.target;
  const firstMover: Color = problem?.black_to_play ? 'B' : 'W';
  // Your claim picks your side: alive = defend the group, dead = attack it.
  const myColor: Color | null = claim === null || !target
    ? null
    : claim === 'alive' ? target.color : other(target.color);
  const engineColor: Color | null = myColor === null ? null : other(myColor);
  const plies = snaps.length - 1;
  const currentMover: Color = plies % 2 === 0 ? firstMover : other(firstMover);
  const myTurn = playing && !thinking && currentMover === myColor;

  // Triangles = the marked group (surviving original points); circle = last move.
  const { annotations, aliveMarks } = useMemo(() => {
    if (!target || !cur) return { annotations: [] as Annotation[], aliveMarks: 0 };
    const occ = new Set(cur.stones.filter((s) => s.color === target.color).map((s) => `${s.x},${s.y}`));
    const marks: Annotation[] = target.chain
      .filter(([x, y]) => occ.has(`${x},${y}`))
      .map(([x, y]) => ({ kind: 'triangle', x, y }));
    const aliveCount = marks.length;
    if (snaps.length > 1) {
      const prevSet = new Set(snaps[snaps.length - 2].stones.map((s) => `${s.x},${s.y},${s.color}`));
      const last = cur.stones.find((s) => !prevSet.has(`${s.x},${s.y},${s.color}`));
      if (last) marks.push({ kind: 'circle', x: last.x, y: last.y });
    }
    return { annotations: marks, aliveMarks: aliveCount };
  }, [target, cur, snaps]);
  const captured = !!target && aliveMarks === 0;
  useEffect(() => {
    if (captured && playing && outcome === null) {
      setOutcome({ result: claim === 'dead' ? 'proved' : 'failed', pointsLost: null });
    }
  }, [captured, playing, outcome, claim]);

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

  // Engine turn: whenever the position rests on the engine's move (including
  // the very first move when the puzzle's mover is the engine's side).
  useEffect(() => {
    if (!playing || outcome !== null || engineColor === null || currentMover !== engineColor) return;
    if (inFlight.current || !cur) return;
    if (!engineReady) return;
    const mySeq = ++seq.current;
    inFlight.current = true;
    setThinking(true);
    setEngineErr(false);
    (async () => {
      try {
        // Surface a wedged reply instead of spinning forever; the console gets
        // the state we know.
        const watchdog = setTimeout(() => {
          if (mySeq !== seq.current) return;
          console.error('[ai-tsumego] engine reply timed out', {
            model: model.id, engineReady, snaps: snaps.length,
          });
          seq.current += 1;
          inFlight.current = false;
          setThinking(false);
          setEngineErr(true);
        }, 45_000);
        let analysis;
        try {
          analysis = await analyzePosition({
            model,
            stones: cur.stones,
            previousStones: snaps[snaps.length - 2]?.stones,
            previousPreviousStones: snaps[snaps.length - 3]?.stones,
            // The puzzle's start position, for the native backend (which
            // rebuilds from initialStones + moves; browser models use stones).
            initialStones: problem ? toStones(problem) : [],
            moves: movesFrom(snaps),
            toPlay: engineColor,
            positionId: `${id}:${snaps.length}:${mySeq}`,
            visits: REPLY_VISITS,
          });
        } finally {
          clearTimeout(watchdog);
        }
        if (mySeq !== seq.current) return;
        if (!analysis) {
          // Superseded/canceled inside the worker — retry rather than stall.
          if (retries.current < 4) { retries.current += 1; setReplyTick((n) => n + 1); }
          else setEngineErr(true);
          return;
        }
        retries.current = 0;
        // Judge: this analysis has the claim's falsifier to move, so a decisive
        // group ownership here settles the claim in either direction. Score is
        // tracked so an inefficient proof can be reported.
        if (!analysis.rootOwnership) setJudgeDebug(`no ownership from model=${model.id}`);
        if (target && analysis.rootOwnership && snaps.length - 1 >= JUDGE_MIN_PLIES) {
          const pts = target.chain.filter(([x, y]) =>
            cur.stones.some((s) => s.x === x && s.y === y && s.color === target.color));
          if (pts.length > 0) {
            const own = pts.reduce((a, [x, y]) => a + analysis.rootOwnership![y * 19 + x], 0) / pts.length;
            setJudgeDebug(`own=${(Math.round(own * 100) / 100).toFixed(2)} pts=${pts.length} target=${target.color} claim=${claim} plies=${snaps.length - 1} model=${model.id}`);
            const ownerHolds = target.color === 'B' ? own > JUDGE_DECIDED : own < -JUDGE_DECIDED;
            const ownerLost = target.color === 'B' ? own < -JUDGE_DECIDED : own > JUDGE_DECIDED;
            const settled = ownerHolds ? 'alive' : ownerLost ? 'dead' : null;
            if (settled) {
              const sign = myColor === 'B' ? 1 : -1;
              const pointsLost = Math.max(0, sign * ((problem?.gen.score_black ?? analysis.rootScoreLead) - analysis.rootScoreLead));
              setOutcome({ result: settled === claim ? 'proved' : 'failed', pointsLost: Math.round(pointsLost * 10) / 10 });
              return;
            }
          }
        }
        const best = analysis.moves[0];
        if (!best) return;   // engine sees nothing to play
        const r = playMove(cur.stones, engineColor, best.x, best.y, cur.koPoint);
        if (!r.ok) return;
        setSnaps((s) => [...s, { stones: r.stones, koPoint: r.koPoint }]);
      } catch {
        if (mySeq === seq.current) setEngineErr(true);
      } finally {
        if (mySeq === seq.current) {
          inFlight.current = false;
          setThinking(false);
        }
      }
    })();
  }, [playing, outcome, engineColor, currentMover, cur, snaps, model, engineReady, id, replyTick, problem]);

  const handleCellClick = (x: number, y: number) => {
    if (!myTurn || outcome !== null || !cur || myColor === null) return;
    const r = playMove(cur.stones, myColor, x, y, cur.koPoint);
    if (!r.ok) return;
    setSnaps((s) => [...s, { stones: r.stones, koPoint: r.koPoint }]);
  };

  const cancelEngine = () => {
    seq.current += 1;
    inFlight.current = false;
    setThinking(false);
  };

  const undo = () => {
    if (myColor === null) return;
    cancelEngine();
    setOutcome(null);
    // Back to the most recent earlier position where it was your turn.
    setSnaps((s) => {
      let p = s.length - 2;
      const moverAt = (n: number) => (n % 2 === 0 ? firstMover : other(firstMover));
      while (p > 0 && moverAt(p) !== myColor) p -= 1;
      return s.slice(0, Math.max(1, p + 1));
    });
  };

  const reset = () => {
    cancelEngine();
    setClaim(null);
    setOutcome(null);
    setRevealed(false);
    if (problem) setSnaps([{ stones: toStones(problem), koPoint: null }]);
  };

  if (missing) {
    return <div className="aits-page"><p>Problem not found. <Link to="/ai-tsumego">Back to AI tsumego</Link></p></div>;
  }
  if (!problem || !cur || !target) return <div className="aits-page"><p>Loading…</p></div>;

  const gen = problem.gen;
  const groupName = target.color === 'B' ? 'Black' : 'White';
  const claimCorrect = claim !== null && claim === target.verdict;

  return (
    <div className="aits-page"><div className="aits-solve">
      <div className="aits-board">
        {!playing && (
          <div className="aits-prompt">
            Is the marked {groupName} group <strong>alive or dead</strong> with{' '}
            {firstMover === 'B' ? 'Black' : 'White'} to play?
            <div className="aits-claim">
              <button type="button" onClick={() => setClaim('alive')}>Alive</button>
              <button type="button" onClick={() => setClaim('dead')}>Dead</button>
            </div>
          </div>
        )}
        {playing && outcome && (
          <div className={outcome.result === 'proved' ? 'aits-prompt aits-verdict-ok' : 'aits-prompt aits-verdict-bad'}>
            {outcome.result === 'proved'
              ? <>Proved — the marked group is <strong>{claim}</strong>.
                {outcome.pointsLost !== null && outcome.pointsLost > 2.5
                  ? <> But the proof cost ~{outcome.pointsLost} points vs best play.</>
                  : outcome.pointsLost !== null ? <> Cleanly, too.</> : null}</>
              : <>Failed — {captured && claim === 'alive'
                  ? 'the marked group has been captured.'
                  : `the group's fate no longer matches your claim (${claim}).`} Undo to retry, or Reveal.</>}
          </div>
        )}
        {playing && !outcome && (
          <div className="aits-prompt aits-prompt-play">
            You claimed the group is <strong>{claim}</strong> — prove it playing{' '}
            <strong>{myColor === 'B' ? 'Black' : 'White'}</strong>
            {claim === 'alive' ? ' (defend the marked group).' : ' (kill the marked group).'}
            {captured && <span className="aits-captured"> The marked group has been captured.</span>}
            {engineErr && <span className="aits-captured"> Engine error — Undo or Reset.</span>}
            {judgeDebug && <span className="aits-provenance"> [{judgeDebug}]</span>}
            {!engineErr && currentMover === engineColor && (
              <em className="aits-thinking">
                {' '}{health === 'warming' ? 'Loading the analysis net…'
                  : thinking ? 'AI is thinking…'
                    : engineReady ? 'AI is thinking…'
                      : 'Waiting for the AI engine — is another tab using it?'}
              </em>
            )}
          </div>
        )}
        {playing && leaseStatus === 'waiting' && (
          <div className="aits-blocked">
            KataGo AI is running in another tab or window — close it to play here.
          </div>
        )}

        <Board stones={cur.stones} annotations={annotations} onCellClick={handleCellClick} />

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
              The marked group is <strong>{target.verdict}</strong> with{' '}
              {firstMover === 'B' ? 'Black' : 'White'} to move
              {claim !== null && <> — your claim was <strong>{claimCorrect ? 'correct' : 'wrong'}</strong></>}.
            </p>
            <p>Best first move <strong>{gen.best_move}</strong>; good moves: {gen.good_moves.join(', ') || '—'}.</p>
            <p>
              Difficulty <strong>{difficultyLabel(gen.difficulty)}</strong> (weakest rank whose
              policy keeps the verdict). Ownership: cheap {target.own_cheap},
              converged {target.own_converged}, after tenuki {target.own_after_tenuki}.
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
