// Fox game sync. The Fox API sends no CORS headers, so the sync runs against
// the local backend (dev-proxied `/api/fox/*`); the games it returns are
// written to Firestore here, client-side, so the deployed app can read them
// with no backend. See docs/fox-sync.md.

import { collection, deleteDoc, doc, getDocs, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { listGames } from './games';
import { deleteReviewsForGames } from './reviews';
import type { FoxAccountDoc, GameDoc } from './model';

const API_BASE = import.meta.env.VITE_KATAGO_API ?? '';

type SyncGame = {
  chessid: string;
  sgf: string;
  created_at: number;
  black_uid: number;
  white_uid: number;
};
type SyncResponse = { uid: number; username: string; games: SyncGame[] };

/** Whether the local Fox sync backend is reachable and has credentials set. */
export async function foxAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/fox/health`);
    return res.ok && (await res.json()).configured === true;
  } catch {
    return false;
  }
}

async function backendSync(
  username: string, mode: 'onboard' | 'incremental', afterChessId?: string,
): Promise<SyncResponse> {
  const res = await fetch(`${API_BASE}/api/fox/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, mode, after_chessid: afterChessId ?? null }),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null))?.detail;
    throw new Error(detail ?? `sync failed (${res.status})`);
  }
  return res.json();
}

const accountsCol = (ownerUid: string) => collection(db, 'users', ownerUid, 'foxAccounts');
const accountDoc = (ownerUid: string, accountUid: number) =>
  doc(db, 'users', ownerUid, 'foxAccounts', String(accountUid));

/** Tracked Fox accounts for a user, by username. */
export async function listFoxAccounts(ownerUid: string): Promise<FoxAccountDoc[]> {
  const snap = await getDocs(accountsCol(ownerUid));
  return snap.docs
    .map((d) => d.data() as FoxAccountDoc)
    .sort((a, b) => a.username.localeCompare(b.username));
}

/** Mark (or unmark) a tracked account as one of the owner's own accounts. */
export async function setFoxAccountMine(
  ownerUid: string, account: FoxAccountDoc, isMine: boolean,
): Promise<void> {
  await setDoc(accountDoc(ownerUid, account.uid), { ...account, isMine });
}

/** Delete a tracked player and their games — but keep any game whose other
 * player is still tracked. Returns the number of games actually deleted. */
export async function deleteFoxPlayer(ownerUid: string, account: FoxAccountDoc): Promise<number> {
  const [games, accounts] = await Promise.all([listGames(ownerUid), listFoxAccounts(ownerUid)]);
  const stillTracked = new Set(accounts.map((a) => a.uid).filter((uid) => uid !== account.uid));
  const doomed = games.filter(
    (g) => g.source === 'fox'
      && (g.blackUid === account.uid || g.whiteUid === account.uid)
      && !stillTracked.has(g.blackUid ?? -1)
      && !stillTracked.has(g.whiteUid ?? -1),
  );
  for (let i = 0; i < doomed.length; i += 400) {
    const batch = writeBatch(db);
    for (const g of doomed.slice(i, i + 400)) batch.delete(doc(db, 'games', g.id));
    await batch.commit();
  }
  await deleteReviewsForGames(ownerUid, new Set(doomed.map((g) => g.id)));
  await deleteDoc(accountDoc(ownerUid, account.uid));
  return doomed.length;
}

/** Write imported games to `games/fox_{chessid}` — deterministic ids make
 * re-sync idempotent (overwrite, no duplicates). */
async function writeGames(ownerUid: string, games: SyncGame[]): Promise<void> {
  if (games.length === 0) return;
  const batch = writeBatch(db);
  for (const g of games) {
    const record: GameDoc = {
      id: `fox_${g.chessid}`,
      ownerUid,
      source: 'fox',
      createdAt: g.created_at,
      sgf: g.sgf,
      blackUid: g.black_uid,
      whiteUid: g.white_uid,
    };
    batch.set(doc(db, 'games', record.id), record);
  }
  await batch.commit();
}

/** Onboard a Fox account: resolve it, back-fill its last 100 games, and record
 * it with a fresh sync cursor. Safe to re-run (overwrites). */
export async function onboardFoxAccount(ownerUid: string, username: string): Promise<FoxAccountDoc> {
  const resp = await backendSync(username, 'onboard');
  await writeGames(ownerUid, resp.games);
  const account: FoxAccountDoc = {
    uid: resp.uid,
    username: resp.username,
    lastChessId: resp.games[0]?.chessid ?? '',   // games are newest-first
    lastSyncedAt: Date.now(),
  };
  await setDoc(accountDoc(ownerUid, resp.uid), account);
  return account;
}

/** Pull games newer than the account's cursor, write them, advance the cursor.
 * Returns the number of new games. */
export async function syncFoxAccount(ownerUid: string, account: FoxAccountDoc): Promise<number> {
  const resp = await backendSync(account.username, 'incremental', account.lastChessId || undefined);
  await writeGames(ownerUid, resp.games);
  await setDoc(accountDoc(ownerUid, account.uid), {
    ...account,
    lastChessId: resp.games[0]?.chessid ?? account.lastChessId,   // newest-first
    lastSyncedAt: Date.now(),
  });
  return resp.games.length;
}
