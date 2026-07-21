import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { Spinner } from '../Spinner';
import { ProblemCard } from '../ProblemCard';
import { FilterChips } from '../FilterChips';
import { toStones } from '../stones';
import { loadStudentData, loadTeacherReview, setVerdicts, type StudentData, type SubmissionView } from '../data/study';
import { listStudents, listTeachers } from '../data/links';
import { findProblem } from '../data/library';
import { SolutionModal } from '../ProblemModal';
import { ToSubmitSection } from '../ToSubmitSection';
import { StuckSection } from './Stuck';
import type { LibProblem, UserDoc, Verdict, VerdictDoc } from '../data/model';
import '../Submissions.css';
import '../Grading.css';

const PAST_PER_PAGE = 12;
const VERDICTS: { v: Verdict; mark: string }[] = [
  { v: 'correct', mark: '✓' },
  { v: 'flag', mark: '⚑' },
  { v: 'incorrect', mark: '✗' },
];

/** Submissions. Player view: your outbox (to-submit) + past submissions to your
 * teachers. Teacher view: grade your students' pending submissions inline, then
 * the same Past-submissions list — filterable by student. */
export function Submissions({ teacherMode = false }: { teacherMode?: boolean }) {
  const { user } = useAuth();
  const uid = user!.uid;
  return (
    <div className="submissions">
      <h1>Submissions</h1>
      {teacherMode ? <TeacherBody teacherUid={uid} /> : <PlayerBody uid={uid} />}
    </div>
  );
}

/** The Past-submissions list — one row per submission — shared by both roles.
 * `who` names the counterparty (the teacher you sent to, or the student who
 * sent it). Rows link to the submission detail. */
function PastSubmissions({ subs, who, teacherMode }: {
  subs: SubmissionView[];
  who: (uid: string) => string;
  teacherMode: boolean;
}) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(subs.length / PAST_PER_PAGE));
  const p = Math.min(page, pageCount - 1);
  const visible = subs.slice(p * PAST_PER_PAGE, (p + 1) * PAST_PER_PAGE);
  return (
    <section className="home-section">
      <div className="section-heading"><h2>Past submissions</h2></div>
      <div className="section-body">
        {subs.length === 0
          ? <p className="dim">{teacherMode
              ? 'No graded submissions yet.'
              : 'Nothing in flight. Save problems from the solver to send them.'}</p>
          : <>
              <ul className="submissions-list">
                {visible.map((s) => <PastRow key={s.submission.id} view={s} who={who} teacherMode={teacherMode} />)}
              </ul>
              {pageCount > 1 && (
                <div className="pager">
                  <button onClick={() => setPage(Math.max(0, p - 1))} disabled={p === 0}>‹ Prev</button>
                  <span className="muted">Page {p + 1} of {pageCount}</span>
                  <button onClick={() => setPage(Math.min(pageCount - 1, p + 1))} disabled={p >= pageCount - 1}>Next ›</button>
                </div>
              )}
            </>}
      </div>
    </section>
  );
}

function PastRow({ view, who, teacherMode }: {
  view: SubmissionView;
  who: (uid: string) => string;
  teacherMode: boolean;
}) {
  const total = view.items.length;
  const reviewed = view.items.filter((it) => it.verdict).length;
  const label = teacherMode
    ? (view.state === 'acked' ? 'Read' : 'Returned')
    : (view.state === 'pending' ? 'Pending review' : view.state === 'returned' ? 'Ready to view' : 'Read');
  const name = who(teacherMode ? view.submission.studentUid : view.submission.teacherUid);
  return (
    <li>
      <Link to={`/submissions/${view.submission.id}`} className="submissions-row-link">
        <div className="submissions-row-main">
          <span className={`submissions-state state-${view.state}`}>{label}</span>
          <span className="submissions-row-teacher">{name}</span>
          <span className="submissions-row-when">submitted {new Date(view.submission.sentAt).toLocaleString()}</span>
        </div>
        <div className="submissions-row-meta">
          {!teacherMode && view.state === 'pending'
            ? `${reviewed} of ${total} reviewed`
            : `${total} problem${total === 1 ? '' : 's'}`}
        </div>
      </Link>
    </li>
  );
}

function PlayerBody({ uid }: { uid: string }) {
  const [data, setData] = useState<StudentData | null>(null);
  const [teachers, setTeachers] = useState<UserDoc[] | null>(null);

  useEffect(() => {
    loadStudentData(uid).then(setData);
    listTeachers(uid).then(setTeachers);
  }, [uid]);

  const teacherName = (tuid: string) => teachers?.find((t) => t.uid === tuid)?.displayName ?? 'teacher';

  if (data === null) return <Spinner />;

  return (
    <>
      <ToSubmitSection />
      <StuckSection />
      <PastSubmissions subs={data.submissions} who={teacherName} teacherMode={false} />
    </>
  );
}

function TeacherBody({ teacherUid }: { teacherUid: string }) {
  const [students, setStudents] = useState<UserDoc[] | null>(null);
  const [views, setViews] = useState<SubmissionView[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [problems, setProblems] = useState<Record<string, LibProblem | null>>({});
  const [open, setOpen] = useState<{ submissionId: string; idx: number } | null>(null);
  // Drafted verdicts (attemptId → verdict), held locally until "Return review".
  const [drafts, setDrafts] = useState<Record<string, Verdict>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    listStudents(teacherUid).then(async (ss) => {
      setStudents(ss);
      setSelected(new Set(ss.map((s) => s.uid)));
      const all = (await Promise.all(ss.map((s) => loadTeacherReview(s.uid, teacherUid)))).flat();
      all.sort((a, b) => b.submission.sentAt - a.submission.sentAt);
      setViews(all);
      const d: Record<string, Verdict> = {};
      for (const v of all) for (const it of v.items) if (it.verdict) d[it.attempt.id] = it.verdict.verdict;
      setDrafts(d);
      const ids = [...new Set(all.flatMap((v) => v.items.map((it) => it.attempt.problemId)))];
      const entries = await Promise.all(ids.map(async (pid) => [pid, await findProblem(pid)] as const));
      setProblems(Object.fromEntries(entries));
    });
  }, [teacherUid]);

  const nameByUid = new Map((students ?? []).map((s) => [s.uid, s.displayName]));
  const studentName = (uid: string) => nameByUid.get(uid) ?? 'student';
  const setDraft = (attemptId: string, v: Verdict) => setDrafts((d) => ({ ...d, [attemptId]: v }));
  const toggleStudent = (key: string) =>
    setSelected((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  // Commit a submission's drafted-but-unsaved verdicts in one batch, then reflect
  // them locally (no reload — keeps grading snappy).
  const sendReview = async (view: SubmissionView) => {
    const changed = view.items
      .filter((it) => drafts[it.attempt.id] && drafts[it.attempt.id] !== it.verdict?.verdict)
      .map((it) => ({ attemptId: it.attempt.id, verdict: drafts[it.attempt.id] }));
    if (changed.length === 0) return;
    setSavingId(view.submission.id);
    try {
      await setVerdicts(view.submission.studentUid, teacherUid, changed);
      const now = Date.now();
      setViews((vs) => (vs ?? []).map((v) => v.submission.id !== view.submission.id ? v : {
        ...v,
        items: v.items.map((it) => {
          const nv = drafts[it.attempt.id];
          if (!nv || nv === it.verdict?.verdict) return it;
          const verdict: VerdictDoc = {
            attemptId: it.attempt.id, studentUid: v.submission.studentUid, teacherUid,
            verdict: nv, comment: '', reviewedAt: now,
          };
          return { ...it, verdict };
        }),
      }));
    } finally {
      setSavingId(null);
    }
  };

  // Pending submissions are graded inline (grading buttons, draft verdicts).
  const renderBatch = (view: SubmissionView) => {
    const drafted = view.items.filter((it) => drafts[it.attempt.id]).length;
    const unsaved = view.items.filter((it) => drafts[it.attempt.id] && drafts[it.attempt.id] !== it.verdict?.verdict).length;
    return (
      <section key={view.submission.id} className="teacher-batch">
        <h2 className="teacher-batch-header">
          <span>
            <span className="teacher-batch-student">{studentName(view.submission.studentUid)}</span>
            Submitted {new Date(view.submission.sentAt).toLocaleString()}
          </span>
          <span className="teacher-batch-actions">
            <span className="teacher-batch-count">{drafted} of {view.items.length} graded</span>
            <button type="button" className="teacher-send-btn"
              disabled={unsaved === 0 || savingId === view.submission.id}
              onClick={() => sendReview(view)}>
              {savingId === view.submission.id ? 'Returning…' : unsaved > 0 ? `Return review (${unsaved})` : 'Returned'}
            </button>
          </span>
        </h2>
        <ul className="problem-card-grid lg">
          {view.items.map(({ attempt, verdict }, idx) => {
            const problem = problems[attempt.problemId];
            const current = drafts[attempt.id];
            const dirty = current && current !== verdict?.verdict;
            return (
              <li key={attempt.id} className="problem-card-cell">
                <button type="button" className="problem-card-clickable"
                  onClick={() => setOpen({ submissionId: view.submission.id, idx })}
                  disabled={!problem} aria-label="Open problem">
                  <ProblemCard
                    stones={problem ? toStones(problem.stones) : []}
                    moves={attempt.moves.map((m) => ({ x: m.col, y: m.row }))}
                    collection={problem?.collection ?? attempt.collection}
                    number={problem ? problem.source_board_idx + 1 : undefined}
                    verdict={current ?? null}
                    className={dirty ? 'dirty' : ''}
                  />
                </button>
                <div className="problem-card-grading">
                  {VERDICTS.map(({ v, mark }) => (
                    <button key={v} className={`mini-verdict ${v}${current === v ? ' selected' : ''}`}
                      onClick={() => setDraft(attempt.id, v)} title={v}>{mark}</button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    );
  };

  if (views === null) return <Spinner />;
  if (students && students.length === 0) return <p className="dim">No linked students yet.</p>;

  const all = views.filter((v) => selected.has(v.submission.studentUid));
  const pending = all.filter((v) => v.items.some((it) => !it.verdict));
  const past = all.filter((v) => v.items.length > 0 && v.items.every((it) => it.verdict));

  return (
    <>
      {students && students.length > 0 && (
        <FilterChips
          chips={students.map((s) => ({ key: s.uid, label: s.displayName }))}
          selected={selected}
          onToggle={toggleStudent}
          label="Filter by student"
        />
      )}

      <section className="home-section">
        <div className="section-heading"><h2>Pending submissions</h2></div>
        <div className="section-body">
          {pending.length === 0 ? <p className="dim">Nothing awaiting review.</p> : pending.map((v) => renderBatch(v))}
        </div>
      </section>
      <StuckSection teacherMode />

      <PastSubmissions subs={past} who={studentName} teacherMode />

      {(() => {
        if (!open) return null;
        const view = views.find((v) => v.submission.id === open.submissionId);
        const cur = view?.items[open.idx];
        const problem = cur ? problems[cur.attempt.problemId] : null;
        if (!view || !cur || !problem) return null;
        const history = views
          .flatMap((v) => v.items)
          .filter((it) => it.attempt.problemId === cur.attempt.problemId)
          .sort((a, b) => b.attempt.createdAt - a.attempt.createdAt)
          .map((it) => ({
            id: it.attempt.id, moves: it.attempt.moves,
            verdict: it.verdict?.verdict ?? null, reviewedAt: it.verdict?.reviewedAt ?? 0,
            createdAt: it.attempt.createdAt,
          }));
        return (
          <SolutionModal
            problem={problem}
            moves={cur.attempt.moves}
            verdict={cur.verdict?.verdict ?? null}
            reviewedAt={cur.verdict?.reviewedAt ?? null}
            defaultMode="explore"
            nav={{
              index: open.idx, total: view.items.length,
              onPrev: () => setOpen((o) => o && { ...o, idx: Math.max(0, o.idx - 1) }),
              onNext: () => setOpen((o) => o && { ...o, idx: Math.min(view.items.length - 1, o.idx + 1) }),
            }}
            history={history}
            onClose={() => setOpen(null)}
          />
        );
      })()}
    </>
  );
}
