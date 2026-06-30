import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../auth';
import { Spinner } from '../Spinner';
import { ProblemCard } from '../ProblemCard';
import { toStones } from '../stones';
import { loadStudentData, type StudentData, type SubmissionItem } from '../data/study';
import { listTeachers } from '../data/links';
import { problemIndex, type ProblemIndex } from '../data/library';
import type { AttemptDoc, UserDoc } from '../data/model';
import '../Submissions.css';
const GROUPS_PER_PAGE = 8;
const ITEMS_PER_PAGE = 60;

export function History() {
  const { user } = useAuth();
  const uid = user!.uid;
  const location = useLocation();
  const [data, setData] = useState<StudentData | null>(null);
  const [index, setIndex] = useState<ProblemIndex | null>(null);
  const [teachers, setTeachers] = useState<UserDoc[] | null>(null);
  const [mode, setMode] = useState<'grouped' | 'flat'>('grouped');
  const [page, setPage] = useState(0);

  const [prevMode, setPrevMode] = useState(mode);
  if (mode !== prevMode) { setPrevMode(mode); setPage(0); }

  const refresh = useCallback(() => {
    loadStudentData(uid).then(setData);
    listTeachers(uid).then(setTeachers);
  }, [uid]);
  useEffect(refresh, [refresh]);
  useEffect(() => { problemIndex().then(setIndex); }, []);

  const teacherName = (tuid: string) => teachers?.find((t) => t.uid === tuid)?.displayName ?? 'teacher';
  const solveHref = (a: AttemptDoc) => {
    const slug = index?.slugByCollection.get(index?.byId.get(a.problemId)?.collection ?? a.collection);
    return slug ? `/solve/${slug}/${a.problemId}` : null;
  };
  const navOf = (items: SubmissionItem[]) =>
    items.map((it) => {
      const slug = index?.slugByCollection.get(index?.byId.get(it.attempt.problemId)?.collection ?? it.attempt.collection);
      return slug ? { slug, id: it.attempt.problemId } : null;
    }).filter((n): n is { slug: string; id: string } => n !== null);

  const reviewedSubs = useMemo(
    () => (data?.submissions ?? []).filter((s) => s.items.some((it) => it.verdict)),
    [data],
  );

  const retryQueue = useMemo(() => {
    if (!data) return [] as SubmissionItem[];
    const latest = new Map<string, SubmissionItem>();
    for (const s of data.submissions) for (const it of s.items) {
      if (!it.verdict) continue;
      const prev = latest.get(it.attempt.problemId);
      if (!prev || it.attempt.createdAt > prev.attempt.createdAt) latest.set(it.attempt.problemId, it);
    }
    return [...latest.values()].filter((it) =>
      it.verdict!.verdict !== 'correct' && (data.latestAttemptAt.get(it.attempt.problemId) ?? 0) <= it.attempt.createdAt);
  }, [data]);

  if (data === null) return <div className="submissions"><Spinner /></div>;

  const retryHref = retryQueue[0] ? solveHref(retryQueue[0].attempt) : null;
  const flatItems = reviewedSubs.flatMap((s) => s.items.filter((it) => it.verdict));
  const pageCount = mode === 'grouped'
    ? Math.max(1, Math.ceil(reviewedSubs.length / GROUPS_PER_PAGE))
    : Math.max(1, Math.ceil(flatItems.length / ITEMS_PER_PAGE));
  const p = Math.min(page, pageCount - 1);

  return (
    <div className="submissions">
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
                      retried={isRetried(it, data)} href={solveHref(it.attempt)} />
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
                      <span>Submitted {new Date(s.submission.sentAt).toLocaleString()} · reviewed by {teacherName(s.submission.teacherUid)}</span>
                      <span className="reviewed-group-count">{items.length} problem{items.length === 1 ? '' : 's'}</span>
                    </h3>
                    <ul className="problem-card-grid">
                      {items.map((it) => (
                        <ReviewTile key={it.attempt.id} item={it} index={index} nav={nav}
                          retried={isRetried(it, data)} href={solveHref(it.attempt)} />
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

function isRetried(it: SubmissionItem, data: StudentData): boolean {
  return (data.latestAttemptAt.get(it.attempt.problemId) ?? 0) > it.attempt.createdAt;
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
