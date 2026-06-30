// Shared types for the static library and the Firestore documents. The
// Firestore shapes mirror docs/migration-spec.md.

export type Verdict = 'correct' | 'incorrect' | 'flag';

// ---------- static library (Firebase Storage) ----------

export type LibStone = { col: number; row: number; color: string };

export type LibProblem = {
  id: string;
  collection: string;
  source_board_idx: number;
  black_to_play: boolean;
  stones: LibStone[];
  image: string | null;
};

export type LibCollection = {
  collection: string;
  slug: string;
  count: number;
  last_uploaded_at: string;
};

// ---------- Firestore ----------

export type Role = 'student' | 'teacher';

export type UserDoc = {
  uid: string;
  displayName: string;
  email: string;
  role: Role;
};

export type Move = { col: number; row: number };

/** `attempts/{attemptId}`. `submissionId === null` ⇒ still in the open batch. */
export type AttemptDoc = {
  id: string;
  studentUid: string;
  problemId: string;
  collection: string;
  moves: Move[];
  blackToPlay: boolean;
  createdAt: number;
  submissionId: string | null;
};

/** `submissions/{submissionId}`. */
export type SubmissionDoc = {
  id: string;
  studentUid: string;
  teacherUid: string;
  sentAt: number;
  acked: boolean;
};

/** `verdicts/{attemptId}`. */
export type VerdictDoc = {
  attemptId: string;
  studentUid: string;
  teacherUid: string;
  verdict: Verdict;
  comment: string;
  reviewedAt: number;
};

/** `links/{studentUid}__{teacherUid}`. */
export type LinkDoc = {
  studentUid: string;
  teacherUid: string;
  createdAt: number;
};
