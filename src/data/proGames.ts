// Pro-game reference database (GoGoD-seeded), served from Firebase:
//
//   proGames/{id}            one game, factual fields only (global, read-only)
//   progames/players.json    player list (Storage) driving search autocomplete
//
// Queries are paginated (page size below) so no single query can return an
// unbounded result set — the guardrail that keeps read volume in the free tier.

import {
  collection, getDocs, limit, orderBy, query, startAfter, where,
  type QueryConstraint, type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase';

export const PAGE_SIZE = 25;

export interface ProGame {
  id: string;
  dateSort: string;
  dateDisplay: string;
  year: number | null;
  black: string;
  white: string;
  blackRank: string;
  whiteRank: string;
  event: string;
  round: string;
  result: string;
  numMoves: number | null;
  players: string[];
}

export interface ProPlayer {
  name: string;
  games: number;
}

export interface GameFilter {
  player?: string; // exact GoGoD name (from the autocomplete)
  from?: string; // inclusive YYYY-MM-DD
  to?: string; // inclusive YYYY-MM-DD
}

export interface GamePage {
  games: ProGame[];
  cursor: QueryDocumentSnapshot | null; // pass to loadMore; null when exhausted
}

// players.json is immutable between publishes, so cache it for the session.
let playersPromise: Promise<ProPlayer[]> | null = null;

export function listPlayers(): Promise<ProPlayer[]> {
  if (!playersPromise) {
    playersPromise = (async () => {
      const url = await getDownloadURL(ref(storage, 'progames/players.json'));
      const r = await fetch(url);
      if (!r.ok) throw new Error(`players.json fetch failed (${r.status})`);
      return (await r.json()) as ProPlayer[];
    })();
  }
  return playersPromise;
}

/** The 10 (by default) most recent games — the landing view. */
export async function recentGames(n = 10): Promise<ProGame[]> {
  const q = query(collection(db, 'proGames'), orderBy('dateSort', 'desc'), limit(n));
  return (await getDocs(q)).docs.map((d) => d.data() as ProGame);
}

/** One page of games matching a player and/or date range, newest first. Pass
 * the previous page's `cursor` to fetch the next page. */
export async function searchGames(
  filter: GameFilter,
  after: QueryDocumentSnapshot | null = null,
): Promise<GamePage> {
  const clauses: QueryConstraint[] = [];
  if (filter.player) clauses.push(where('players', 'array-contains', filter.player));
  if (filter.from) clauses.push(where('dateSort', '>=', filter.from));
  if (filter.to) clauses.push(where('dateSort', '<=', filter.to));
  clauses.push(orderBy('dateSort', 'desc'));
  if (after) clauses.push(startAfter(after));
  clauses.push(limit(PAGE_SIZE));

  const snap = await getDocs(query(collection(db, 'proGames'), ...clauses));
  return {
    games: snap.docs.map((d) => d.data() as ProGame),
    cursor: snap.docs.length === PAGE_SIZE ? snap.docs[snap.docs.length - 1] : null,
  };
}
