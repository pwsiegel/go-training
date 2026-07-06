import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth';
import { Spinner } from '../Spinner';
import { ProblemCard } from '../ProblemCard';
import { FilterChips } from '../FilterChips';
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

/** The teacher's inbox of student work, filtered by student with the shared
 * chip filter. `mode` picks the surface: `pending` grades submissions awaiting
 * review; `history` is the read-only record of graded submissions. */
export function Teacher({ mode }: { mode: 'pending' | 'history' }) {
  const { user } = useAuth();
  const teacherUid = user!.uid;

  const [students, setStudents] = useState<UserDoc[] | null>(null);
  const [views, setViews] = useState<SubmissionView[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [problems, setProblems] = useState<Record<string, LibProblem | null>>({});
  const [open, setOpen] = useState<{ submissionId: string; idx: number } | null>(null);
  // Drafted verdicts (attemptId → verdict), held locally until "Return review".
  const [drafts, setDrafts] = useState<Record<string, Verdict>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const refresh = useCallback(() => {
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

  useEffect(refresh, [refresh]);

  const nameByUid = new Map((students ?? []).map((s) => [s.uid, s.displayName]));

  const setDraft = (attemptId: string, v: Verdict) => setDrafts((d) => ({ ...d, [attemptId]: v }));

  const toggleStudent = (key: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

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
            <span className="teacher-batch-student">{nameByUid.get(view.submission.studentUid) ?? 'student'}</span>
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

  const all = (views ?? []).filter((v) => selected.has(v.submission.studentUid));
  const pending = all.filter((v) => v.items.some((it) => !it.verdict));
  const history = all.filter((v) => v.items.length > 0 && v.items.every((it) => it.verdict));
  const shown = mode === 'pending' ? pending : history;

  const chips = (students ?? []).map((s) => ({ key: s.uid, label: s.displayName }));

  return (
    <div className="teacher">
      <div className="teacher-header"><h1>{mode === 'pending' ? 'Submissions' : 'History'}</h1></div>

      {students && students.length > 1 && (
        <FilterChips chips={chips} selected={selected} onToggle={toggleStudent} label="Filter by student" />
      )}

      {views === null ? <Spinner /> : students && students.length === 0
        ? <p className="teacher-empty">No linked students yet.</p>
        : shown.length === 0
          ? <p className="teacher-empty-sub">
              {mode === 'pending' ? 'Nothing awaiting review.' : 'No graded submissions yet.'}
            </p>
          : shown.map((v) => renderBatch(v, mode === 'pending', mode === 'history'))}

      {(() => {
        if (!open) return null;
        const view = (views ?? []).find((v) => v.submission.id === open.submissionId);
        const cur = view?.items[open.idx];
        const problem = cur ? problems[cur.attempt.problemId] : null;
        if (!view || !cur || !problem) return null;
        const history = (views ?? [])
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
