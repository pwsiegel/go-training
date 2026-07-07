// Saved games on Firestore, for the review page.
//
//   games/{gameId}   a completed game (see GameDoc); owned by ownerUid.
//
// Games are queried by owner and sorted client-side (no composite index needed).

import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import { sgfInfo } from '../sgf';
import type { GameDoc } from './model';

/** Win/loss of a Fox game from the perspective of a set of the owner's own
 * account uids. Null when neither participant is one of "my" accounts, or the
 * SGF result isn't a plain Black/White win (e.g. void, unfinished). */
export function gameOutcome(game: GameDoc, myUids: Set<number>): 'win' | 'loss' | null {
  const myColor =
    game.blackUid != null && myUids.has(game.blackUid) ? 'B'
      : game.whiteUid != null && myUids.has(game.whiteUid) ? 'W'
        : null;
  if (!myColor) return null;
  const winner = sgfInfo(game.sgf).result[0];
  if (winner !== 'B' && winner !== 'W') return null;
  return winner === myColor ? 'win' : 'loss';
}

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
