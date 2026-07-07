import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../auth';
import { Spinner } from '../Spinner';
import { ProblemCard } from '../ProblemCard';
import { FilterChips } from '../FilterChips';
import { toStones } from '../stones';
import { loadStudentData, loadTeacherReview, type SubmissionItem, type SubmissionView } from '../data/study';
import { listStudents, listTeachers } from '../data/links';
import { problemIndex, type ProblemIndex } from '../data/library';
import type { AttemptDoc, UserDoc } from '../data/model';
import '../Submissions.css';

const GROUPS_PER_PAGE = 8;
const ITEMS_PER_PAGE = 60;

/** Graded-problem history. Player view: your own reviewed problems, with a
 * Retry queue. Teacher view: the problems you've graded for your students,
 * filterable by student. Both share the By-submission / View-all toggle. */
export function History({ teacherMode = false }: { teacherMode?: boolean }) {
  const { user } = useAuth();
  const uid = user!.uid;
  const location = useLocation();
  const [subs, setSubs] = useState<SubmissionView[] | null>(null);
  const [latestAttemptAt, setLatestAttemptAt] = useState<Map<string, number>>(new Map());
  const [index, setIndex] = useState<ProblemIndex | null>(null);
  const [people, setPeople] = useState<UserDoc[]>([]); // teachers (player) or students (teacher)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<'grouped' | 'flat'>('grouped');
  const [page, setPage] = useState(0);

  const [prevMode, setPrevMode] = useState(mode);
  if (mode !== prevMode) { setPrevMode(mode); setPage(0); }

  useEffect(() => {
    if (teacherMode) {
      listStudents(uid).then(async (ss) => {
        const all = (await Promise.all(ss.map((s) => loadTeacherReview(s.uid, uid)))).flat();
        setPeople(ss);
        setSelected(new Set(ss.map((s) => s.uid)));
        setSubs(all);
      });
    } else {
      loadStudentData(uid).then((d) => { setSubs(d.submissions); setLatestAttemptAt(d.latestAttemptAt); });
      listTeachers(uid).then(setPeople);
    }
  }, [uid, teacherMode]);
  useEffect(() => { problemIndex().then(setIndex); }, []);

  const nameOf = (id: string) => people.find((p) => p.uid === id)?.displayName ?? (teacherMode ? 'student' : 'teacher');
  const solveHref = (a: AttemptDoc) => {
    const slug = index?.slugByCollection.get(index?.byId.get(a.problemId)?.collection ?? a.collection);
    return slug ? `/solve/${slug}/${a.problemId}` : null;
  };
  const navOf = (items: SubmissionItem[]) =>
    items.map((it) => {
      const slug = index?.slugByCollection.get(index?.byId.get(it.attempt.problemId)?.collection ?? it.attempt.collection);
      return slug ? { slug, id: it.attempt.problemId } : null;
    }).filter((n): n is { slug: string; id: string } => n !== null);
  const isRetried = (it: SubmissionItem) => (latestAttemptAt.get(it.attempt.problemId) ?? 0) > it.attempt.createdAt;

  const reviewedSubs = useMemo(
    () => (subs ?? [])
      .filter((s) => s.items.some((it) => it.verdict))
      .filter((s) => !teacherMode || selected.has(s.submission.studentUid)),
    [subs, teacherMode, selected],
  );

  // Retry queue is a player concept — the latest not-yet-reattempted wrong answers.
  const retryQueue = useMemo(() => {
    if (teacherMode || !subs) return [] as SubmissionItem[];
    const latest = new Map<string, SubmissionItem>();
    for (const s of subs) for (const it of s.items) {
      if (!it.verdict) continue;
      const prev = latest.get(it.attempt.problemId);
      if (!prev || it.attempt.createdAt > prev.attempt.createdAt) latest.set(it.attempt.problemId, it);
    }
    return [...latest.values()].filter((it) =>
      it.verdict!.verdict !== 'correct' && (latestAttemptAt.get(it.attempt.problemId) ?? 0) <= it.attempt.createdAt);
  }, [subs, teacherMode, latestAttemptAt]);

  const toggle = (key: string) =>
    setSelected((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  if (subs === null) return <div className="submissions"><Spinner /></div>;

  const retryHref = retryQueue[0] ? solveHref(retryQueue[0].attempt) : null;
  const flatItems = reviewedSubs.flatMap((s) => s.items.filter((it) => it.verdict));
  const pageCount = mode === 'grouped'
    ? Math.max(1, Math.ceil(reviewedSubs.length / GROUPS_PER_PAGE))
    : Math.max(1, Math.ceil(flatItems.length / ITEMS_PER_PAGE));
  const p = Math.min(page, pageCount - 1);

  return (
    <div className="submissions">
      {teacherMode && people.length > 0 && (
        <FilterChips
          chips={people.map((s) => ({ key: s.uid, label: s.displayName }))}
          selected={selected}
          onToggle={toggle}
          label="Filter by student"
        />
      )}
      <section className="home-section">
        <div className="section-heading">
          <h2>History</h2>
          {reviewedSubs.length > 0 && (
            <div className="reviewed-header-actions">
              <div className="reviewed-toggle">
                <button type="button" className={`reviewed-toggle-btn${mode === 'grouped' ? ' active' : ''}`}
                  onClick={() => setMode('grouped')}>By submission</button>
                <button type="button" className={`reviewed-toggle-btn${mode === 'flat' ? ' active' : ''}`}
                  onClick={() => setMode('flat')}>View all</button>
              </div>
              {retryHref && (
                <Link to={retryHref} state={{ backgroundLocation: location }} className="submission-retry-btn">Retry ({retryQueue.length})</Link>
              )}
            </div>
          )}
        </div>
        <div className="section-body">
          {reviewedSubs.length === 0 ? <p className="dim">Nothing graded yet.</p>
            : mode === 'flat'
              ? (() => {
                  const items = flatItems.slice(p * ITEMS_PER_PAGE, (p + 1) * ITEMS_PER_PAGE);
                  const nav = navOf(items);
                  return (
                    <ul className="problem-card-grid">
                      {items.map((it) => (
                        <ReviewTile key={it.attempt.id} item={it} index={index} nav={nav}
                          retried={isRetried(it)} href={solveHref(it.attempt)} />
                      ))}
                    </ul>
                  );
                })()
              : <div className="reviewed-groups">
                  {reviewedSubs.slice(p * GROUPS_PER_PAGE, (p + 1) * GROUPS_PER_PAGE).map((s) => {
                    const items = s.items.filter((it) => it.verdict);
                    const nav = navOf(items);
                    return (
                      <section key={s.submission.id} className="reviewed-group">
                        <h3 className="reviewed-group-header">
                          <span>
                            Submitted {new Date(s.submission.sentAt).toLocaleString()}
                            {teacherMode
                              ? <> · {nameOf(s.submission.studentUid)}</>
                              : <> · reviewed by {nameOf(s.submission.teacherUid)}</>}
                          </span>
                          <span className="reviewed-group-count">{items.length} problem{items.length === 1 ? '' : 's'}</span>
                        </h3>
                        <ul className="problem-card-grid">
                          {items.map((it) => (
                            <ReviewTile key={it.attempt.id} item={it} index={index} nav={nav}
                              retried={isRetried(it)} href={solveHref(it.attempt)} />
                          ))}
                        </ul>
                      </section>
                    );
                  })}
                </div>}

          {pageCount > 1 && (
            <div className="pager">
              <button onClick={() => setPage(Math.max(0, p - 1))} disabled={p === 0}>‹ Prev</button>
              <span className="muted">Page {p + 1} of {pageCount}</span>
              <button onClick={() => setPage(Math.min(pageCount - 1, p + 1))} disabled={p >= pageCount - 1}>Next ›</button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function ReviewTile({
  item, index, retried, href, nav,
}: {
  item: SubmissionItem; index: ProblemIndex | null;
  retried: boolean; href: string | null; nav: { slug: string; id: string }[];
}) {
  const location = useLocation();
  const problem = index?.byId.get(item.attempt.problemId) ?? null;
  const v = item.verdict!;
  const card = (
    <ProblemCard
      stones={problem ? toStones(problem.stones) : []}
      moves={item.attempt.moves.map((m) => ({ x: m.col, y: m.row }))}
      collection={problem?.collection ?? item.attempt.collection}
      number={problem ? problem.source_board_idx + 1 : undefined}
      verdict={v.verdict}
      retried={retried && v.verdict !== 'correct'}
    />
  );
  return (
    <li>
      {href
        ? <Link to={href} state={{ backgroundLocation: location, nav }} className="problem-card-link">{card}</Link>
        : card}
    </li>
  );
}
