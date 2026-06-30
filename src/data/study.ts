// Solve attempts, batches, submissions, and verdicts on Firestore.
//
// Model (see docs/migration-spec.md):
//   attempts/{id}        a solve attempt; submissionId === null ⇒ open batch
//   submissions/{id}     a sent batch addressed to one teacher
//   verdicts/{attemptId} the teacher's review of one attempt
//
// A submission's state is derived, mirroring the old backend:
//   pending  — at least one attempt has no verdict yet
//   returned — all reviewed, not yet acked
//   acked    — student marked it read

import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc, updateDoc, writeBatch,
  query, where, orderBy,
} from 'firebase/firestore';
import { db } from '../firebase';
import type {
  AttemptDoc, Move, SubmissionDoc, Verdict, VerdictDoc, LibProblem,
} from './model';

export type SubmissionState = 'pending' | 'returned' | 'acked';

function newId(prefix: string): string {
  return doc(collection(db, prefix)).id;
}

// ---------- attempts ----------

export async function saveAttempt(
  studentUid: string, problem: LibProblem, moves: Move[],
): Promise<AttemptDoc> {
  const id = newId('attempts');
  const record: AttemptDoc = {
    id,
    studentUid,
    problemId: problem.id,
    collection: problem.collection,
    moves,
    blackToPlay: problem.black_to_play,
    createdAt: Date.now(),
    submissionId: null,
  };
  await setDoc(doc(db, 'attempts', id), record);
  return record;
}

export async function attemptsForProblem(
  studentUid: string, problemId: string,
): Promise<AttemptDoc[]> {
  const q = query(
    collection(db, 'attempts'),
    where('studentUid', '==', studentUid),
    where('problemId', '==', problemId),
    orderBy('createdAt'),
  );
  return (await getDocs(q)).docs.map((d) => d.data() as AttemptDoc);
}

function latestPerProblem(attempts: AttemptDoc[]): AttemptDoc[] {
  const byPid = new Map<string, AttemptDoc>();
  for (const a of attempts) {
    const prev = byPid.get(a.problemId);
    if (!prev || a.createdAt > prev.createdAt) byPid.set(a.problemId, a);
  }
  return [...byPid.values()].sort((a, b) => a.createdAt - b.createdAt);
}

// ---------- batch (unsent attempts) ----------

async function unsentAttempts(studentUid: string): Promise<AttemptDoc[]> {
  const q = query(
    collection(db, 'attempts'),
    where('studentUid', '==', studentUid),
    where('submissionId', '==', null),
  );
  return (await getDocs(q)).docs.map((d) => d.data() as AttemptDoc);
}

/** Latest unsent attempt per problem — what would be sent next. */
export async function listBatch(studentUid: string): Promise<AttemptDoc[]> {
  return latestPerProblem(await unsentAttempts(studentUid));
}

export async function removeFromBatch(studentUid: string, problemId: string): Promise<void> {
  const unsent = (await unsentAttempts(studentUid)).filter((a) => a.problemId === problemId);
  await Promise.all(unsent.map((a) => deleteDoc(doc(db, 'attempts', a.id))));
}

/** Send the current batch to one teacher as a single submission. Latest
 * attempt per problem is submitted; older unsent duplicates are discarded. */
export async function sendBatch(
  studentUid: string, teacherUid: string,
): Promise<SubmissionDoc> {
  const unsent = await unsentAttempts(studentUid);
  const latest = new Set(latestPerProblem(unsent).map((a) => a.id));

  const submissionId = newId('submissions');
  const submission: SubmissionDoc = {
    id: submissionId,
    studentUid,
    teacherUid,
    sentAt: Date.now(),
    acked: false,
  };
  await setDoc(doc(db, 'submissions', submissionId), submission);

  await Promise.all(unsent.map((a) =>
    latest.has(a.id)
      ? updateDoc(doc(db, 'attempts', a.id), { submissionId })
      : deleteDoc(doc(db, 'attempts', a.id)),
  ));
  return submission;
}

// ---------- submissions ----------

/** All of a student's attempts (one rules-safe query). */
async function allAttempts(studentUid: string): Promise<AttemptDoc[]> {
  const q = query(collection(db, 'attempts'), where('studentUid', '==', studentUid));
  return (await getDocs(q)).docs.map((d) => d.data() as AttemptDoc);
}

/** All of a student's verdicts, keyed by attemptId (one rules-safe query). */
export async function verdictsByAttempt(studentUid: string): Promise<Map<string, VerdictDoc>> {
  const q = query(collection(db, 'verdicts'), where('studentUid', '==', studentUid));
  const m = new Map<string, VerdictDoc>();
  for (const d of (await getDocs(q)).docs) {
    const v = d.data() as VerdictDoc;
    m.set(v.attemptId, v);
  }
  return m;
}

export type SubmissionItem = {
  attempt: AttemptDoc;
  verdict: VerdictDoc | null;
};

export type SubmissionView = {
  submission: SubmissionDoc;
  state: SubmissionState;
  items: SubmissionItem[];
};

function submissionState(sub: SubmissionDoc, items: SubmissionItem[]): SubmissionState {
  if (!items.every((it) => it.verdict)) return 'pending';
  return sub.acked ? 'acked' : 'returned';
}

function buildView(
  submission: SubmissionDoc, attempts: AttemptDoc[], verdicts: Map<string, VerdictDoc>,
): SubmissionView {
  const items: SubmissionItem[] = attempts
    .filter((a) => a.submissionId === submission.id)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((a) => ({ attempt: a, verdict: verdicts.get(a.id) ?? null }));
  return { submission, state: submissionState(submission, items), items };
}

export async function getSubmission(submissionId: string): Promise<SubmissionView | null> {
  const snap = await getDoc(doc(db, 'submissions', submissionId));
  if (!snap.exists()) return null;
  const submission = snap.data() as SubmissionDoc;
  // Filter attempts by studentUid (rules-safe) then by submission in memory.
  const attempts = await allAttempts(submission.studentUid);
  const verdicts = await verdictsByAttempt(submission.studentUid);
  return buildView(submission, attempts, verdicts);
}

export async function listSubmissions(studentUid: string): Promise<SubmissionDoc[]> {
  const q = query(
    collection(db, 'submissions'),
    where('studentUid', '==', studentUid),
    orderBy('sentAt', 'desc'),
  );
  return (await getDocs(q)).docs.map((d) => d.data() as SubmissionDoc);
}

export type ProblemStatus = { lastVerdict: Verdict | null; attempted: boolean };

/** Per-problem status for the current student: whether they've attempted it and
 * the most recent verdict (null = attempted but ungraded). Drives grid badges. */
export async function problemStatuses(studentUid: string): Promise<Map<string, ProblemStatus>> {
  const [attempts, verdicts] = await Promise.all([
    allAttempts(studentUid),
    verdictsByAttempt(studentUid),
  ]);
  const problemOf = new Map<string, string>();
  const out = new Map<string, ProblemStatus>();
  for (const a of attempts) {
    problemOf.set(a.id, a.problemId);
    if (!out.has(a.problemId)) out.set(a.problemId, { lastVerdict: null, attempted: true });
  }
  const latestAt = new Map<string, number>();
  for (const v of verdicts.values()) {
    const pid = problemOf.get(v.attemptId);
    if (!pid) continue;
    if (v.reviewedAt >= (latestAt.get(pid) ?? -1)) {
      latestAt.set(pid, v.reviewedAt);
      out.set(pid, { lastVerdict: v.verdict, attempted: true });
    }
  }
  return out;
}

export type StudentData = {
  batch: AttemptDoc[];
  submissions: SubmissionView[];
  /** Latest attempt timestamp per problem (across drafts + sent) — lets the
   * history view tell whether a non-correct problem has since been retried. */
  latestAttemptAt: Map<string, number>;
};

/** Everything the student dashboard needs in three rules-safe queries:
 * the draft batch (latest unsent per problem) and every sent submission with
 * its attempts + verdicts already attached. Replaces per-submission fan-out. */
export async function loadStudentData(studentUid: string): Promise<StudentData> {
  const [attempts, verdicts, subs] = await Promise.all([
    allAttempts(studentUid),
    verdictsByAttempt(studentUid),
    listSubmissions(studentUid),
  ]);
  const batch = latestPerProblem(attempts.filter((a) => a.submissionId === null));
  const submissions = subs.map((s) => buildView(s, attempts, verdicts));
  const latestAttemptAt = new Map<string, number>();
  for (const a of attempts) {
    latestAttemptAt.set(a.problemId, Math.max(latestAttemptAt.get(a.problemId) ?? 0, a.createdAt));
  }
  return { batch, submissions, latestAttemptAt };
}

export async function ackSubmission(submissionId: string): Promise<void> {
  await updateDoc(doc(db, 'submissions', submissionId), { acked: true });
}

// ---------- teacher side ----------

/** Submissions addressed to this teacher from this student, newest first. */
export async function teacherSubmissions(
  studentUid: string, teacherUid: string,
): Promise<SubmissionDoc[]> {
  const q = query(
    collection(db, 'submissions'),
    where('teacherUid', '==', teacherUid),
    where('studentUid', '==', studentUid),
    orderBy('sentAt', 'desc'),
  );
  return (await getDocs(q)).docs.map((d) => d.data() as SubmissionDoc);
}

/** A teacher's review of one student's submissions, in rules-safe queries:
 * the student's attempts (teacher allowed via the link) and this teacher's own
 * verdicts (queried by teacherUid, which the rules permit). */
export async function loadTeacherReview(
  studentUid: string, teacherUid: string,
): Promise<SubmissionView[]> {
  const [subs, attemptDocs, verdictDocs] = await Promise.all([
    teacherSubmissions(studentUid, teacherUid),
    getDocs(query(collection(db, 'attempts'), where('studentUid', '==', studentUid))),
    getDocs(query(collection(db, 'verdicts'), where('teacherUid', '==', teacherUid))),
  ]);
  const attempts = attemptDocs.docs.map((d) => d.data() as AttemptDoc);
  const verdicts = new Map<string, VerdictDoc>();
  for (const d of verdictDocs.docs) {
    const v = d.data() as VerdictDoc;
    verdicts.set(v.attemptId, v);
  }
  return subs.map((s) => buildView(s, attempts, verdicts));
}

export async function setVerdict(
  studentUid: string, teacherUid: string, attemptId: string,
  verdict: Verdict, comment = '',
): Promise<void> {
  const record: VerdictDoc = {
    attemptId, studentUid, teacherUid, verdict, comment, reviewedAt: Date.now(),
  };
  await setDoc(doc(db, 'verdicts', attemptId), record);
}

/** Write many verdicts in one batched commit (draft-then-send grading). */
export async function setVerdicts(
  studentUid: string, teacherUid: string,
  entries: { attemptId: string; verdict: Verdict }[],
): Promise<void> {
  if (entries.length === 0) return;
  const now = Date.now();
  const batch = writeBatch(db);
  for (const e of entries) {
    batch.set(doc(db, 'verdicts', e.attemptId), {
      attemptId: e.attemptId, studentUid, teacherUid,
      verdict: e.verdict, comment: '', reviewedAt: now,
    });
  }
  await batch.commit();
}
