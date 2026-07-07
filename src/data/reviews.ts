// Saved variation trees on Firestore, for game review.
//
//   reviews/{reviewId}   a user's variation tree for a game (see ReviewDoc).
//
// Owner-only: a student's and a teacher's reviews of the same game are separate
// docs. The mainline is not stored (rebuilt from the game SGF); only the
// off-mainline nodes are. Writes are debounced + fire-and-forget by the caller.

import { collection, deleteDoc, doc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import type { ReviewDoc } from './model';

const reviewsCol = collection(db, 'reviews');

/** A fresh review document id. */
export function newReviewId(): string {
  return doc(reviewsCol).id;
}

/** The user's review of a game — the single one surfaced today (most recently
 * updated if somehow more than one exists), or null. */
export async function loadReview(ownerUid: string, gameId: string): Promise<ReviewDoc | null> {
  const q = query(reviewsCol, where('ownerUid', '==', ownerUid), where('gameId', '==', gameId));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return snap.docs.map((d) => d.data() as ReviewDoc).sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

/** Create or overwrite a review doc. */
export async function saveReview(review: ReviewDoc): Promise<void> {
  await setDoc(doc(db, 'reviews', review.id), review);
}

/** Delete the owner's review(s) for a game — orphan cleanup on game deletion. */
export async function deleteReviewsForGame(ownerUid: string, gameId: string): Promise<void> {
  const q = query(reviewsCol, where('ownerUid', '==', ownerUid), where('gameId', '==', gameId));
  const snap = await getDocs(q);
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
}

/** Bulk variant: delete the owner's reviews for any of `gameIds` in one read. */
export async function deleteReviewsForGames(ownerUid: string, gameIds: Set<string>): Promise<void> {
  if (gameIds.size === 0) return;
  const snap = await getDocs(query(reviewsCol, where('ownerUid', '==', ownerUid)));
  await Promise.all(
    snap.docs.filter((d) => gameIds.has((d.data() as ReviewDoc).gameId)).map((d) => deleteDoc(d.ref)),
  );
}
