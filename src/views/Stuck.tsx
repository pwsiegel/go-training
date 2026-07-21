import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../auth';
import { Spinner } from '../Spinner';
import { ProblemCard } from '../ProblemCard';
import { toStones } from '../stones';
import { watchStuck, removeStuck } from '../data/stuck';
import { attemptsForProblem, verdictsByAttempt } from '../data/study';
import { listStudents } from '../data/links';
import { problemIndex, type ProblemIndex } from '../data/library';
import { SolutionModal, type HistoryEntry } from '../ProblemModal';
import type { UserDoc } from '../data/model';
import '../Submissions.css';

/** The stuck set, as a section on the Submissions page (beneath the pending
 * outbox, same look). Player: problems you've parked — solve them, remove
 * them; membership is yours alone (submitting a problem removes it
 * automatically). Teacher: a live, read-only window onto each linked
 * student's stuck set, with every previous attempt visible per problem. */
export function StuckSection({ teacherMode = false }: { teacherMode?: boolean }) {
  return teacherMode ? <TeacherStuck /> : <PlayerStuck />;
}

function PlayerStuck() {
  const { user } = useAuth();
  const uid = user!.uid;
  const location = useLocation();
  const [ids, setIds] = useState<string[] | null>(null);
  const [index, setIndex] = useState<ProblemIndex | null>(null);

  useEffect(() => watchStuck(uid, setIds), [uid]);
  useEffect(() => { problemIndex().then(setIndex); }, []);

  const nav = useMemo(() => {
    if (!index || !ids) return [];
    return ids.map((id) => {
      const p = index.byId.get(id);
      const slug = p ? index.slugByCollection.get(p.collection) : undefined;
      return slug ? { slug, id } : null;
    }).filter((n): n is { slug: string; id: string } => n !== null);
  }, [index, ids]);

  return (
    <section className="home-section">
      <div className="section-heading"><h2>Stuck problems</h2></div>
      <div className="section-body">
        {ids === null || index === null ? <Spinner />
          : ids.length === 0
            ? <p className="dim">Nothing parked. Use "Mark stuck" on a problem's solve page — your teacher sees this list live.</p>
            : (
              <ul className="problem-card-grid">
                {ids.map((pid) => {
                  const problem = index.byId.get(pid);
                  if (!problem) return null;
                  const slug = index.slugByCollection.get(problem.collection);
                  const card = (
                    <ProblemCard
                      stones={toStones(problem.stones)}
                      collection={problem.collection}
                      number={problem.source_board_idx + 1}
                      stuck
                    />
                  );
                  return (
                    <li key={pid} className="problem-card-cell">
                      <button type="button" className="problem-card-remove" aria-label="Remove from stuck" title="Remove from stuck"
                        onClick={() => removeStuck(uid, [pid])}>×</button>
                      {slug
                        ? <Link to={`/solve/${slug}/${pid}`} state={{ backgroundLocation: location, nav }} className="problem-card-link">{card}</Link>
                        : card}
                    </li>
                  );
                })}
              </ul>
            )}
      </div>
    </section>
  );
}

function TeacherStuck() {
  const { user } = useAuth();
  const uid = user!.uid;
  const [students, setStudents] = useState<UserDoc[] | null>(null);
  const [stuckByStudent, setStuckByStudent] = useState<Map<string, string[]>>(new Map());
  const [index, setIndex] = useState<ProblemIndex | null>(null);
  const [open, setOpen] = useState<{ studentUid: string; problemId: string } | null>(null);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);

  // Load the student's attempt history for the opened problem (verdicts are
  // the teacher's own — the only ones the rules let her query).
  useEffect(() => {
    if (!open) return;
    let on = true;
    Promise.all([
      attemptsForProblem(open.studentUid, open.problemId),
      verdictsByAttempt(open.studentUid, uid).catch(() => new Map()),
    ]).then(([atts, verdicts]) => {
      if (!on) return;
      setHistory([...atts]
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((a) => ({
          id: a.id, moves: a.moves,
          verdict: verdicts.get(a.id)?.verdict ?? null,
          reviewedAt: verdicts.get(a.id)?.reviewedAt ?? 0,
          createdAt: a.createdAt,
        })));
    });
    return () => { on = false; };
  }, [open, uid]);

  useEffect(() => { listStudents(uid).then(setStudents); }, [uid]);
  useEffect(() => { problemIndex().then(setIndex); }, []);

  // One live subscription per student; the map updates as students edit.
  useEffect(() => {
    if (!students) return;
    const unsubs = students.map((s) =>
      watchStuck(s.uid, (ids) =>
        setStuckByStudent((m) => { const n = new Map(m); n.set(s.uid, ids); return n; })));
    return () => unsubs.forEach((u) => u());
  }, [students]);

  if (students === null || index === null) {
    return (
      <section className="home-section">
        <div className="section-heading"><h2>Stuck problems</h2></div>
        <div className="section-body"><Spinner /></div>
      </section>
    );
  }

  const withStuck = students.filter((s) => (stuckByStudent.get(s.uid) ?? []).length > 0);

  return (
      <section className="home-section">
        <div className="section-heading"><h2>Stuck problems</h2></div>
        <div className="section-body">
          {withStuck.length === 0 ? <p className="dim">No student has stuck problems right now.</p> : (
            withStuck.map((s) => (
              <section key={s.uid} className="reviewed-group">
                <h3 className="reviewed-group-header">
                  <span>{s.displayName}</span>
                  <span className="reviewed-group-count">
                    {stuckByStudent.get(s.uid)!.length} problem{stuckByStudent.get(s.uid)!.length === 1 ? '' : 's'}
                  </span>
                </h3>
                <ul className="problem-card-grid lg">
                  {stuckByStudent.get(s.uid)!.map((pid) => {
                    const problem = index.byId.get(pid);
                    if (!problem) return null;
                    return (
                      <li key={`${s.uid}:${pid}`}>
                        <button type="button" className="problem-card-link stuck-open-btn"
                          onClick={() => setOpen({ studentUid: s.uid, problemId: pid })}>
                          <ProblemCard
                            stones={toStones(problem.stones)}
                            collection={problem.collection}
                            number={problem.source_board_idx + 1}
                            stuck
                          />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
        {open && index.byId.get(open.problemId) && (
          <SolutionModal
            problem={index.byId.get(open.problemId)!}
            moves={history?.[0]?.moves ?? []}
            defaultMode="explore"
            history={history ?? []}
            historyOpen
            onClose={() => { setOpen(null); setHistory(null); }}
          />
        )}
      </section>
  );
}
