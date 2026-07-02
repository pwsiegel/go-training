// Saved games on Firestore, for the review page.
//
//   games/{gameId}   a completed game (see GameDoc); owned by ownerUid.
//
// Games are queried by owner and sorted client-side (no composite index needed).

import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import type { GameDoc } from './model';

export async function saveGame(game: Omit<GameDoc, 'id'>): Promise<GameDoc> {
  const id = doc(collection(db, 'games')).id;
  const record: GameDoc = { ...game, id };
  await setDoc(doc(db, 'games', id), record);
  return record;
}

/** A user's games, newest first. */
export async function listGames(ownerUid: string): Promise<GameDoc[]> {
  const q = query(collection(db, 'games'), where('ownerUid', '==', ownerUid));
  return (await getDocs(q)).docs
    .map((d) => d.data() as GameDoc)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function getGame(id: string): Promise<GameDoc | null> {
  const snap = await getDoc(doc(db, 'games', id));
  return snap.exists() ? (snap.data() as GameDoc) : null;
}

export async function deleteGame(id: string): Promise<void> {
  await deleteDoc(doc(db, 'games', id));
}
