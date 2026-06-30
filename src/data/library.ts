// Static problem library, fetched from auth-gated Firebase Storage under
// library/. Download URLs require an authenticated, allowlisted user (Storage
// rules). Results are cached in-memory for the session since the library is
// immutable between deploys.

import { ref, getDownloadURL } from 'firebase/storage';
import { storage } from '../firebase';
import type { LibCollection, LibProblem } from './model';

const urlCache = new Map<string, string>();
const jsonCache = new Map<string, unknown>();

async function storageUrl(path: string): Promise<string> {
  const cached = urlCache.get(path);
  if (cached) return cached;
  const url = await getDownloadURL(ref(storage, path));
  urlCache.set(path, url);
  return url;
}

async function fetchJson<T>(path: string): Promise<T> {
  const cached = jsonCache.get(path);
  if (cached) return cached as T;
  const url = await storageUrl(path);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`library fetch failed: ${path} (${r.status})`);
  const data = (await r.json()) as T;
  jsonCache.set(path, data);
  return data;
}

export function listCollections(): Promise<LibCollection[]> {
  return fetchJson<LibCollection[]>('library/index.json');
}

export function listProblems(slug: string): Promise<LibProblem[]> {
  return fetchJson<LibProblem[]>(`library/collections/${slug}.json`);
}

export async function getProblem(slug: string, id: string): Promise<LibProblem | null> {
  const problems = await listProblems(slug);
  return problems.find((p) => p.id === id) ?? null;
}

/** Find a problem by id across all collections (cached). Used by the batch /
 * submission views, which key off attempt.problemId without a known slug. */
export async function findProblem(id: string): Promise<LibProblem | null> {
  for (const c of await listCollections()) {
    const found = (await listProblems(c.slug)).find((p) => p.id === id);
    if (found) return found;
  }
  return null;
}

/** A signed/download URL for a problem's scan crop, or null if it has none. */
export function imageUrl(image: string | null): Promise<string> | null {
  if (!image) return null;
  return storageUrl(`library/${image}`);
}

export type ProblemIndex = {
  byId: Map<string, LibProblem>;
  slugByCollection: Map<string, string>;
};

let indexPromise: Promise<ProblemIndex> | null = null;

/** All problems keyed by id, plus collection-name → slug. Cached for the
 * session; used by the submission/history views that key off problem ids. */
export function problemIndex(): Promise<ProblemIndex> {
  if (!indexPromise) {
    indexPromise = (async () => {
      const cols = await listCollections();
      const byId = new Map<string, LibProblem>();
      const slugByCollection = new Map<string, string>();
      for (const c of cols) {
        slugByCollection.set(c.collection, c.slug);
        for (const p of await listProblems(c.slug)) byId.set(p.id, p);
      }
      return { byId, slugByCollection };
    })();
  }
  return indexPromise;
}
