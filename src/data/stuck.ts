// The "stuck" set: problems the student has parked for help/later thought.
// One doc per student (`stuck/{studentUid}`) holding the problem ids; the
// student controls membership, a linked teacher watches it live (read-only —
// see firestore.rules). Sending a batch removes any submitted problems
// (study.ts/sendBatch), so a problem leaves the set the moment it's handed
// to the teacher through the normal flow.
import {
  arrayRemove, arrayUnion, doc, getDoc, onSnapshot, setDoc,
} from 'firebase/firestore';
import { db } from '../firebase';

export type StuckDoc = {
  studentUid: string;
  problemIds: string[];
  updatedAt: number;
};

const ref = (studentUid: string) => doc(db, 'stuck', studentUid);

/** Live subscription to a student's stuck set (own, or as a linked teacher). */
export function watchStuck(
  studentUid: string, cb: (problemIds: string[]) => void,
): () => void {
  return onSnapshot(ref(studentUid), (snap) => {
    cb(snap.exists() ? ((snap.data() as StuckDoc).problemIds ?? []) : []);
  });
}

/** One-shot read (for badge/filter computations in non-live views). */
export async function getStuckSet(studentUid: string): Promise<Set<string>> {
  const snap = await getDoc(ref(studentUid));
  return new Set(snap.exists() ? ((snap.data() as StuckDoc).problemIds ?? []) : []);
}

export async function addStuck(studentUid: string, problemId: string): Promise<void> {
  await setDoc(ref(studentUid),
    { studentUid, problemIds: arrayUnion(problemId), updatedAt: Date.now() },
    { merge: true });
}

export async function removeStuck(studentUid: string, problemIds: string[]): Promise<void> {
  if (problemIds.length === 0) return;
  await setDoc(ref(studentUid),
    { studentUid, problemIds: arrayRemove(...problemIds), updatedAt: Date.now() },
    { merge: true });
}
