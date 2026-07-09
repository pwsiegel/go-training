// users/{uid} profile docs.

import {
  doc, getDoc, setDoc, updateDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { PlayDefaults, Role, UserDoc } from './model';

export type Profile = UserDoc;

/** Read the profile, creating it on first sign-in (default role: player). */
export async function ensureProfile(
  uid: string, email: string, displayName: string,
): Promise<Profile> {
  const ref = doc(db, 'users', uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    return snap.data() as Profile;
  }
  const profile: Profile = {
    uid,
    email,
    displayName: displayName || email,
    role: 'player',
  };
  await setDoc(ref, { ...profile, createdAt: serverTimestamp() });
  return profile;
}

export async function setDisplayName(uid: string, displayName: string): Promise<void> {
  await updateDoc(doc(db, 'users', uid), { displayName });
}

export async function setRole(uid: string, role: Role): Promise<void> {
  await updateDoc(doc(db, 'users', uid), { role });
}

export async function setPlayDefaults(uid: string, playDefaults: PlayDefaults): Promise<void> {
  await updateDoc(doc(db, 'users', uid), { playDefaults });
}
