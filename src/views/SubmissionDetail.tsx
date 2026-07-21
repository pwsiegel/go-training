import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../auth';
import { Spinner } from '../Spinner';
import { ProblemCard } from '../ProblemCard';
import { toStones } from '../stones';
import { getSubmission, ackSubmission, type SubmissionView } from '../data/study';
import { getStuckSet } from '../data/stuck';
import { findProblem, listCollections } from '../data/library';
import type { LibProblem } from '../data/model';
import '../Collection.css';
import '../Submissions.css';
const STATE_LABEL: Record<string, string> = { pending: 'Pending review', returned: 'Ready to view', acked: 'Read' };

export function SubmissionDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const location = useLocation();
  const [view, setView] = useState<SubmissionView | null>(null);
  const [problems, setProblems] = useState<Record<string, LibProblem | null>>({});
  const [stuckSet, setStuckSet] = useState<Set<string>>(new Set());
  const [slugByCollection, setSlugByCollection] = useState<Record<string, string>>({});

  useEffect(() => {
    listCollections().then((cols) =>
      setSlugByCollection(Object.fromEntries(cols.map((c) => [c.collection, c.slug]))),
    );
  }, []);

  const refresh = useCallback(() => {
    if (!id) return;
    getSubmission(id).then(async (v) => {
      setView(v);
      if (v) {
        const entries = await Promise.all(
          v.items.map(async (it) => [it.attempt.problemId, await findProblem(it.attempt.problemId)] as const),
        );
        setProblems(Object.fromEntries(entries));
      }
    });
  }, [id]);

  useEffect(refresh, [refresh]);
  // Badge problems currently in the student's stuck set (own view: my set;
  // teacher view: the submission's student is readable via the same doc).
  useEffect(() => {
    if (view) getStuckSet(view.submission.studentUid).then(setStuckSet).catch(() => {});
  }, [view]);

  if (view === null) return <div className="picker"><Spinner /></div>;

  // Scope in-modal navigation to this submission's problems (in display order).
  const nav = view.items
    .map((it) => {
      const p = problems[it.attempt.problemId];
      const slug = p ? slugByCollection[p.collection] : undefined;
      return slug ? { slug, id: it.attempt.problemId } : null;
    })
    .filter((n): n is { slug: string; id: string } => n !== null);

  return (
    <div className="picker">
      <div className="picker-header">
        <Link to="/submissions" className="back-link" style={{ fontSize: '0.85rem', color: 'var(--text-faint)', textDecoration: 'none' }}>← submissions</Link>
        <h1>Submission</h1>
        <p className="picker-meta">
          <span className={`submissions-state state-${view.state}`}>{STATE_LABEL[view.state]}</span>
          {' '}· submitted {new Date(view.submission.sentAt).toLocaleString()} · {view.items.length} problem{view.items.length === 1 ? '' : 's'}
        </p>
        {view.state === 'returned' && view.submission.studentUid === user?.uid && (
          <div style={{ marginTop: '0.75rem' }}>
            <button className="submissions-submit-btn" onClick={() => ackSubmission(view.submission.id).then(refresh)}>
              Mark as read
            </button>
          </div>
        )}
      </div>

      <ul className="problem-card-grid">
        {view.items.map(({ attempt, verdict }) => {
          const problem = problems[attempt.problemId];
          const slug = problem ? slugByCollection[problem.collection] : undefined;
          const card = (
            <ProblemCard
              stones={problem ? toStones(problem.stones) : []}
              moves={attempt.moves.map((m) => ({ x: m.col, y: m.row }))}
              collection={problem?.collection}
              number={problem ? problem.source_board_idx + 1 : undefined}
              verdict={verdict?.verdict ?? null}
              stuck={stuckSet.has(attempt.problemId)}
            />
          );
          return (
            <li key={attempt.id}>
              {slug
                ? <Link to={`/solve/${slug}/${attempt.problemId}`} state={{ backgroundLocation: location, nav }} className="problem-card-link">{card}</Link>
                : card}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
