import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams, type Location } from 'react-router-dom';
import { useAuth } from '../auth';
import { useBatch } from '../batch';
import { Spinner } from '../Spinner';
import { Board } from '../Board';
import { ProblemCard } from '../ProblemCard';
import { PlayView } from '../PlayView';
import { computeNumberedOverlay, type MovePoint } from '../numberedMoves';
import { toStones, boundingViewport } from '../stones';
import { listProblems, imageUrl } from '../data/library';
import { saveAttempt, attemptsForProblem, verdictsByAttempt } from '../data/study';
import { watchStuck, addStuck, removeStuck } from '../data/stuck';
import type { AttemptDoc, LibProblem, Verdict, VerdictDoc } from '../data/model';
import '../Solve.css';

const VERDICT_MARK: Record<Verdict, string> = { correct: '✓', flag: '⚑', incorrect: '✗' };
const VERDICT_TEXT: Record<Verdict, string> = {
  correct: 'Marked correct', incorrect: 'Marked incorrect', flag: 'Flagged for discussion',
};

export function Solve() {
  const { slug, id } = useParams<{ slug: string; id: string }>();
  const { user } = useAuth();
  const uid = user!.uid;
  const navigate = useNavigate();
  const location = useLocation();
  const { refresh: refreshBatch } = useBatch();
  // When opened as a route-modal, keep the background page on internal nav and
  // `replace` so prev/next/save don't stack history — clicking off the modal
  // (navigate(-1)) then returns to the background, not the previous problem.
  // `nav`, when present (e.g. opened from a submission), scopes prev/next to
  // that ordered list of {slug,id} instead of the whole collection.
  const linkState = location.state as { backgroundLocation?: Location; nav?: { slug: string; id: string }[] } | null;
  const backgroundLocation = linkState?.backgroundLocation;
  const navList = linkState?.nav;
  const navState = backgroundLocation
    ? { state: { backgroundLocation, nav: navList }, replace: true } : undefined;

  const [siblings, setSiblings] = useState<LibProblem[] | null>(null);
  const [stuckIds, setStuckIds] = useState<Set<string>>(new Set());
  const [moves, setMoves] = useState<MovePoint[]>([]);
  const [history, setHistory] = useState<AttemptDoc[] | null>(null);
  const [verdicts, setVerdicts] = useState<Record<string, VerdictDoc | null>>({});
  const [flash, setFlash] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [originalSrc, setOriginalSrc] = useState<string | null>(null);
  const [mode, setMode] = useState<'solve' | 'explore'>('solve');

  // Render-phase reset when the problem changes.
  const [prevId, setPrevId] = useState(id);
  if (id !== prevId) {
    setPrevId(id);
    setMoves([]);
    setFlash(null);
    setHistory(null);
    setOriginalSrc(null);
    setMode('solve');
  }

  useEffect(() => { if (slug) listProblems(slug).then(setSiblings); }, [slug]);

  const problem = useMemo(() => siblings?.find((p) => p.id === id) ?? null, [siblings, id]);
  // Navigation list: the scoped `nav` (e.g. a submission) or the whole collection.
  const navItems = useMemo(
    () => navList ?? (siblings ?? []).map((p) => ({ slug: slug!, id: p.id })),
    [navList, siblings, slug],
  );
  const navPos = navItems.findIndex((n) => n.id === id);
  const navTotal = navItems.length;

  useEffect(() => {
    const u = imageUrl(problem?.image ?? null);
    if (u) u.then(setOriginalSrc);
  }, [problem?.image]);

  useEffect(() => {
    if (!id) return;
    attemptsForProblem(uid, id).then(async (atts) => {
      setHistory(atts);
      // Prefill from the latest attempt so iterating doesn't require re-tapping.
      const last = atts[atts.length - 1];
      if (last) setMoves(last.moves.map((m) => ({ x: m.col, y: m.row })));
      const vmap = await verdictsByAttempt(uid);
      const vs: Record<string, VerdictDoc | null> = {};
      for (const a of atts) vs[a.id] = vmap.get(a.id) ?? null;
      setVerdicts(vs);
    });
  }, [uid, id]);

  const latestVerdict = useMemo(() => {
    const vs = Object.values(verdicts).filter((v): v is VerdictDoc => !!v);
    return vs.sort((a, b) => b.reviewedAt - a.reviewedAt)[0] ?? null;
  }, [verdicts]);

  // All attempts, newest first, for the history panel.
  const attemptsDesc = useMemo(
    () => [...(history ?? [])].sort((a, b) => b.createdAt - a.createdAt),
    [history],
  );

  useEffect(() => watchStuck(uid, (ids) => setStuckIds(new Set(ids))), [uid]);

  if (siblings === null) return <div className="solve"><Spinner /></div>;
  if (!problem) return <div className="solve"><p>Problem not found.</p></div>;

  const stones = toStones(problem.stones);
  const overlay = computeNumberedOverlay(moves);
  const viewport = boundingViewport([...stones, ...moves.map((m) => ({ x: m.x, y: m.y, color: 'B' as const }))], 5);

  const goToNav = (pos: number) => { const t = navItems[pos]; if (t) navigate(`/solve/${t.slug}/${t.id}`, navState); };

  const isStuck = !!id && stuckIds.has(id);
  const toggleStuck = () => {
    if (!id) return;
    void (isStuck ? removeStuck(uid, [id]) : addStuck(uid, id));
  };

  const save = async () => {
    if (moves.length === 0) { setFlash('Play at least one move first.'); return; }
    setSaving(true);
    try {
      await saveAttempt(uid, problem, moves.map((m) => ({ col: m.x, row: m.y })));
      refreshBatch();
      if (navPos + 1 < navTotal) goToNav(navPos + 1);
      else setFlash(navList ? 'Saved — last problem in this submission.' : 'Saved — last problem in collection.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="solve">
      <div className="solve-header">
        <h1>
          {problem.collection}{' '}
          <span className="solve-counter">#{problem.source_board_idx + 1}</span>
        </h1>
        <span className="solve-counter">{problem.black_to_play ? 'Black' : 'White'} to play · {navPos + 1} / {navTotal}</span>
      </div>

      {latestVerdict && (
        <div className={`solve-verdict-banner v-${latestVerdict.verdict}`}>
          <span className="solve-verdict-mark">{VERDICT_MARK[latestVerdict.verdict]}</span>
          {VERDICT_TEXT[latestVerdict.verdict]} · {new Date(latestVerdict.reviewedAt).toLocaleDateString()}
        </div>
      )}

      <div className="solve-mode-toggle">
        <button className={mode === 'solve' ? 'active' : ''} onClick={() => setMode('solve')}>Solve</button>
        <button className={mode === 'explore' ? 'active' : ''} onClick={() => setMode('explore')}>Explore</button>
      </div>

      {mode === 'explore' ? (
        <PlayView initialStones={stones} />
      ) : (
        <>
          <div className="solve-workspace">
            <div className="solve-board">
              <Board
                stones={stones}
                viewport={viewport}
                numberedMoves={overlay.boardNumbers}
                onCellClick={(x, y) => setMoves((m) => [...m, { x, y }])}
              />
            </div>
            {overlay.chains.length > 0 && (
              <aside className="solve-chains" aria-label="Move sequence">
                <div className="solve-chains-title">Sequence</div>
                <ol className="solve-chains-list">
                  {overlay.chains.map((chain, i) => (
                    <li key={i} className="chain">
                      {chain.map((n, j) => (
                        <span key={j}>
                          {j > 0 && <span className="chain-sep">→</span>}
                          <span className="chain-num">{n}</span>
                        </span>
                      ))}
                    </li>
                  ))}
                </ol>
              </aside>
            )}
          </div>

          <div className="solve-info">
            <span>{moves.length} move{moves.length === 1 ? '' : 's'}</span>
            <div className="solve-actions">
              <button onClick={() => setMoves((m) => m.slice(0, -1))} disabled={!moves.length || saving}>Undo</button>
              <button onClick={() => setMoves([])} disabled={!moves.length || saving}>Clear</button>
              <button className={isStuck ? 'solve-stuck-btn active' : 'solve-stuck-btn'} onClick={toggleStuck}
                title={isStuck ? 'Remove from your stuck set' : 'Park this problem in your stuck set (shared live with your teacher)'}>
                {isStuck ? '⚑ Stuck' : '⚑ Stuck?'}
              </button>
              <button onClick={() => goToNav(navPos - 1)} disabled={navPos <= 0 || saving}>‹ Prev</button>
              <button className="solve-save-continue" onClick={save} disabled={!moves.length || saving}>
                {saving ? 'Saving…' : 'Save & continue ›'}
              </button>
              <button onClick={() => goToNav(navPos + 1)} disabled={navPos + 1 >= navTotal || saving}>Next ›</button>
            </div>
          </div>

          {flash && <div className="solve-flash">{flash}</div>}
        </>
      )}

      {originalSrc && (
        <details className="solve-original">
          <summary>View original</summary>
          <img src={originalSrc} alt={`Original crop for problem #${problem.source_board_idx + 1}`} />
        </details>
      )}

      {attemptsDesc.length > 0 && (
        <details className="solve-history">
          <summary>Attempt history ({attemptsDesc.length})</summary>
          <ul className="problem-card-grid lg">
            {attemptsDesc.map((a) => {
              const v = verdicts[a.id];
              return (
                <li key={a.id}>
                  <ProblemCard
                    stones={stones}
                    moves={a.moves.map((m) => ({ x: m.col, y: m.row }))}
                    collection={problem.collection}
                    number={problem.source_board_idx + 1}
                    verdict={v?.verdict ?? null}
                  />
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </div>
  );
}
