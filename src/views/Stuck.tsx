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
import type { AttemptDoc, UserDoc, VerdictDoc } from '../data/model';
import '../Submissions.css';
import './Stuck.css';

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
            ? <p className="dim">Nothing parked. Mark a problem with ⚑ on its solve page — your teacher sees this list live.</p>
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
                <ul className="problem-card-grid">
                  {stuckByStudent.get(s.uid)!.map((pid) => (
                    <StuckProblem key={`${s.uid}:${pid}`} studentUid={s.uid} problemId={pid} index={index} />
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </section>
  );
}

/** One stuck problem in the teacher view: the position, expandable to the
 * student's full attempt history on it (latest first, verdicts included). */
function StuckProblem({ studentUid, problemId, index }: {
  studentUid: string; problemId: string; index: ProblemIndex;
}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [attempts, setAttempts] = useState<AttemptDoc[] | null>(null);
  const [verdicts, setVerdicts] = useState<Map<string, VerdictDoc>>(new Map());
  const problem = index.byId.get(problemId);

  useEffect(() => {
    if (!open || attempts !== null) return;
    attemptsForProblem(studentUid, problemId).then((as) =>
      setAttempts([...as].sort((a, b) => b.createdAt - a.createdAt)));
    verdictsByAttempt(studentUid, user!.uid).then(setVerdicts).catch(() => {});
  }, [open, attempts, studentUid, problemId, user]);

  if (!problem) return null;

  return (
    <li className={open ? 'stuck-teacher-item open' : 'stuck-teacher-item'}>
      <button type="button" className="stuck-expand" onClick={() => setOpen((o) => !o)}
        aria-expanded={open}>
        <ProblemCard
          stones={toStones(problem.stones)}
          collection={problem.collection}
          number={problem.source_board_idx + 1}
          bar={false}
        />
      </button>
      {open && (
        <div className="stuck-attempts">
          {attempts === null ? <Spinner />
            : attempts.length === 0 ? <p className="dim">No attempts yet.</p>
              : (
                <ul className="problem-card-grid stuck-attempts-grid">
                  {attempts.map((a) => (
                    <li key={a.id}>
                      <ProblemCard
                        stones={toStones(problem.stones)}
                        moves={a.moves.map((m) => ({ x: m.col, y: m.row }))}
                        collection={new Date(a.createdAt).toLocaleString()}
                        verdict={verdicts.get(a.id)?.verdict ?? null}
                      />
                    </li>
                  ))}
                </ul>
              )}
        </div>
      )}
    </li>
  );
}
