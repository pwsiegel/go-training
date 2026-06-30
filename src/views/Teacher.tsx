import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth';
import { Spinner } from '../Spinner';
import { ProblemCard } from '../ProblemCard';
import { toStones } from '../stones';
import { listStudents } from '../data/links';
import { loadTeacherReview, setVerdicts, type SubmissionView } from '../data/study';
import { findProblem } from '../data/library';
import { SolutionModal } from '../ProblemModal';
import type { LibProblem, UserDoc, Verdict, VerdictDoc } from '../data/model';
import '../Teacher.css';

const VERDICTS: { v: Verdict; mark: string }[] = [
  { v: 'correct', mark: '✓' },
  { v: 'flag', mark: '⚑' },
  { v: 'incorrect', mark: '✗' },
];

export function Teacher() {
  const { user } = useAuth();
  const { studentUid: filter } = useParams<{ studentUid: string }>();
  const teacherUid = user!.uid;

  const [students, setStudents] = useState<UserDoc[] | null>(null);
  const [views, setViews] = useState<SubmissionView[] | null>(null);
  const [problems, setProblems] = useState<Record<string, LibProblem | null>>({});
  const [open, setOpen] = useState<{ submissionId: string; idx: number } | null>(null);
  // Drafted verdicts (attemptId → verdict), held locally until "Return review".
  const [drafts, setDrafts] = useState<Record<string, Verdict>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    listStudents(teacherUid).then(async (ss) => {
      setStudents(ss);
      const targets = filter ? ss.filter((s) => s.uid === filter) : ss;
      const all = (await Promise.all(targets.map((s) => loadTeacherReview(s.uid, teacherUid)))).flat();
      all.sort((a, b) => b.submission.sentAt - a.submission.sentAt);
      setViews(all);
      const d: Record<string, Verdict> = {};
      for (const v of all) for (const it of v.items) if (it.verdict) d[it.attempt.id] = it.verdict.verdict;
      setDrafts(d);
      const ids = [...new Set(all.flatMap((v) => v.items.map((it) => it.attempt.problemId)))];
      const entries = await Promise.all(ids.map(async (pid) => [pid, await findProblem(pid)] as const));
      setProblems(Object.fromEntries(entries));
    });
  }, [teacherUid, filter]);

  useEffect(refresh, [refresh]);

  const nameByUid = new Map((students ?? []).map((s) => [s.uid, s.displayName]));

  const setDraft = (attemptId: string, v: Verdict) => setDrafts((d) => ({ ...d, [attemptId]: v }));

  // Commit a submission's drafted-but-unsaved verdicts in one batch, then
  // reflect them locally (no reload — keeps grading snappy).
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

  // Pending submissions are graded inline (grading buttons, draft verdicts);
  // history is read-only — the same verdict card the student sees, with no
  // ability to override a returned decision.
  const renderBatch = (view: SubmissionView, large = false, readOnly = false) => {
    const drafted = view.items.filter((it) => drafts[it.attempt.id]).length;
    const unsaved = view.items.filter((it) => drafts[it.attempt.id] && drafts[it.attempt.id] !== it.verdict?.verdict).length;
    return (
      <section key={view.submission.id} className="teacher-batch">
        <h2 className="teacher-batch-header">
          <span>
            {!filter && <span className="teacher-batch-student">{nameByUid.get(view.submission.studentUid) ?? 'student'}</span>}
            Submitted {new Date(view.submission.sentAt).toLocaleString()}
          </span>
          {!readOnly && (
            <span className="teacher-batch-actions">
              <span className="teacher-batch-count">{drafted} of {view.items.length} graded</span>
              <button type="button" className="teacher-send-btn"
                disabled={unsaved === 0 || savingId === view.submission.id}
                onClick={() => sendReview(view)}>
                {savingId === view.submission.id ? 'Returning…' : unsaved > 0 ? `Return review (${unsaved})` : 'Returned'}
              </button>
            </span>
          )}
        </h2>
        <ul className={`problem-card-grid${large ? ' lg' : ''}`}>
          {view.items.map(({ attempt, verdict }, idx) => {
            const problem = problems[attempt.problemId];
            const current = drafts[attempt.id];
            const dirty = current && current !== verdict?.verdict;
            const card = (
              <button type="button" className="problem-card-clickable"
                onClick={() => setOpen({ submissionId: view.submission.id, idx })}
                disabled={!problem} aria-label="Open problem">
                <ProblemCard
                  stones={problem ? toStones(problem.stones) : []}
                  moves={attempt.moves.map((m) => ({ x: m.col, y: m.row }))}
                  collection={problem?.collection ?? attempt.collection}
                  number={problem ? problem.source_board_idx + 1 : undefined}
                  verdict={readOnly ? (verdict?.verdict ?? null) : (current ?? null)}
                  bar={readOnly}
                  className={!readOnly && dirty ? 'dirty' : ''}
                />
              </button>
            );
            if (readOnly) return <li key={attempt.id}>{card}</li>;
            return (
              <li key={attempt.id} className="problem-card-cell">
                {card}
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

  const all = views ?? [];
  const pending = all.filter((v) => v.items.some((it) => !it.verdict));
  const history = all.filter((v) => v.items.length > 0 && v.items.every((it) => it.verdict));

  return (
    <div className="teacher">
      <div className="teacher-header"><h1>Submissions</h1></div>

      {students && students.length > 0 && (
        <div className="teacher-filter">
          <Link to="/teacher" className={`teacher-filter-chip${!filter ? ' active' : ''}`}>All students</Link>
          {students.map((s) => (
            <Link key={s.uid} to={`/teacher/${s.uid}`} className={`teacher-filter-chip${filter === s.uid ? ' active' : ''}`}>
              {s.displayName}
            </Link>
          ))}
        </div>
      )}

      {views === null ? <Spinner /> : students && students.length === 0
        ? <p className="teacher-empty">No linked students yet.</p>
        : <>
            <h2 className="teacher-section-title">Pending submissions</h2>
            {pending.length === 0
              ? <p className="teacher-empty-sub">Nothing awaiting review.</p>
              : pending.map((v) => renderBatch(v, true))}

            <h2 className="teacher-section-title">Submission history</h2>
            {history.length === 0
              ? <p className="teacher-empty-sub">No graded submissions yet.</p>
              : history.map((v) => renderBatch(v, false, true))}
          </>}

      {(() => {
        if (!open) return null;
        const view = all.find((v) => v.submission.id === open.submissionId);
        const cur = view?.items[open.idx];
        const problem = cur ? problems[cur.attempt.problemId] : null;
        if (!view || !cur || !problem) return null;
        const history = all
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
    </div>
  );
}
