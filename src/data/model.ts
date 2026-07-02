// Shared types for the static library and the Firestore documents. The
// Firestore shapes mirror docs/migration-spec.md.

import type { Color } from '../types';

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

// ---------- play vs KataGo (games / review) ----------

/** Grouping key on the review page — the site/app a game was played on. This
 * app ("Go Training") is the first source; other sites can be added later. */
export type GameSource = 'go-training';

export type GameMove = { color: Color; x: number; y: number };

/** `games/{gameId}` — a saved game to review. Local-dev feature (play vs KataGo). */
export type GameDoc = {
  id: string;
  ownerUid: string;
  source: GameSource;
  createdAt: number;
  myColor: Color;
  rank: string;          // humanSLProfile, e.g. "rank_9k"
  rankLabel: string;     // "9 kyu"
  temperature: number;
  sgf: string;           // the game as SGF (players, ranks, moves)
  scoreAt: Record<string, number>;   // moveCount -> lead (Black's perspective)
  moveCount: number;
  finalScore: number | null;         // last recorded estimate
};
