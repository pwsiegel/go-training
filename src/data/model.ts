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

// ---------- games / review ----------

/** Where a game came from. Locally-played KataGo games are `go-training`;
 * games imported from Fox Weiqi are `fox`. Other sites can be added later. */
export type GameSource = 'go-training' | 'fox';

export type GameMove = { color: Color; x: number; y: number };

/** `games/{gameId}` — a game to review. Either a locally-played KataGo game
 * (the play-vs-KataGo fields) or one imported from an external server (the
 * import fields). The SGF is the source of truth for players, result, moves. */
export type GameDoc = {
  id: string;
  ownerUid: string;
  source: GameSource;
  createdAt: number;
  sgf: string;
  // play vs KataGo only — absent on imported games
  myColor?: Color;
  rank?: string;                      // humanSLProfile, e.g. "rank_9k"
  rankLabel?: string;                 // "9 kyu"
  temperature?: number;
  scoreAt?: Record<string, number>;   // moveCount -> lead (Black's perspective)
  moveCount?: number;
  finalScore?: number | null;         // last recorded estimate
  // imported (Fox) only — participant uids, for the account filter
  blackUid?: number;
  whiteUid?: number;
};

/** `users/{uid}/foxAccounts/{accountUid}` — a tracked Fox player and its
 * incremental-sync cursor. The Fox account uid is the document id. */
export type FoxAccountDoc = {
  uid: number;
  username: string;
  lastChessId: string;   // newest synced game; sync pulls only games newer than this
  lastSyncedAt: number;  // ms epoch of the last successful sync
};
