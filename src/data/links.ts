// Student ↔ teacher links: links/{studentUid}__{teacherUid}. Links are created
// by admin tooling only (the migration / grant flow); clients can't create them
// (the security rules forbid it), so the read-only helpers below are all the app needs.

import {
  collection, doc, getDoc, getDocs, query, where,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { LinkDoc, UserDoc } from './model';

async function usersFor(uids: string[]): Promise<UserDoc[]> {
  const out: UserDoc[] = [];
  for (const uid of uids) {
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists()) out.push(snap.data() as UserDoc);
  }
  return out;
}

/** Teachers this student has linked. */
export async function listTeachers(studentUid: string): Promise<UserDoc[]> {
  const q = query(collection(db, 'links'), where('studentUid', '==', studentUid));
  const links = await getDocs(q);
  return usersFor(links.docs.map((d) => (d.data() as LinkDoc).teacherUid));
}

/** Students who have linked this teacher. */
export async function listStudents(teacherUid: string): Promise<UserDoc[]> {
  const q = query(collection(db, 'links'), where('teacherUid', '==', teacherUid));
  const links = await getDocs(q);
  return usersFor(links.docs.map((d) => (d.data() as LinkDoc).studentUid));
}
