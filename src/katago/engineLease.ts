// A single exclusive lease on the in-browser KataGo (WebGPU) engine, shared
// across every same-origin tab/window via the Web Locks API. Only one context
// may hold a resident GPU model at a time — this prevents two b18 nets stacking
// in the shared GPU process, which causes device-loss ("external Instance
// reference no longer exists") that kills analysis everywhere at once.
//
// The lease is reference-counted per tab, so Review and Play within one tab
// share it (no dispose/reload churn when navigating between them). On the last
// release it drops the lock AND disposes the engine worker, freeing VRAM so
// another window can take over. There is no preemption: a held lease is released
// only when its context turns AI off, navigates away, or closes (the browser
// releases Web Locks automatically on close/crash — the reason to prefer them
// over a hand-rolled heartbeat).

import { useEffect } from 'react';
import { useSyncExternalStore } from 'react';
import { disposeKataGoEngineClient } from './engine/katago/client';

const LOCK_NAME = 'katago-webgpu-engine';
const WAITING_HINT_MS = 150;   // only surface "waiting" if a grant doesn't come near-instantly

export type LeaseStatus = 'idle' | 'waiting' | 'active';

const locksSupported =
  typeof navigator !== 'undefined' && typeof navigator.locks?.request === 'function';

let status: LeaseStatus = 'idle';
let refCount = 0;
let releaseHeld: (() => void) | null = null;   // resolves the lock-holding promise
let waitAbort: AbortController | null = null;   // cancels a still-queued request
const listeners = new Set<() => void>();

function emit() { for (const l of listeners) l(); }
function setStatus(next: LeaseStatus) { if (next !== status) { status = next; emit(); } }

function acquire() {
  if (!locksSupported) { setStatus('active'); return; }   // no coordination — behave as before
  const ctrl = new AbortController();
  waitAbort = ctrl;
  let granted = false;
  navigator.locks
    .request(LOCK_NAME, { mode: 'exclusive', signal: ctrl.signal }, () =>
      new Promise<void>((resolve) => { granted = true; releaseHeld = resolve; setStatus('active'); }),
    )
    .catch(() => { /* aborted while queued — released before it was granted */ });
  // Don't flash "waiting" on the common case where the lock is free (grant is
  // near-instant); only show it if another context is genuinely holding it.
  setTimeout(() => { if (!granted && refCount > 0 && status !== 'active') setStatus('waiting'); }, WAITING_HINT_MS);
}

function release() {
  waitAbort?.abort();
  waitAbort = null;
  releaseHeld?.();
  releaseHeld = null;
  setStatus('idle');
  disposeKataGoEngineClient();   // free the WebGPU device for whoever's next
}

/** A context wants the browser engine. Acquires the lock on the 0→1 edge. */
export function retainEngine() {
  refCount += 1;
  if (refCount === 1) acquire();
}

/** A context no longer wants it. On the 1→0 edge, releases the lock + disposes. */
export function releaseEngine() {
  refCount = Math.max(0, refCount - 1);
  if (refCount === 0) release();
}

function subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; }
function snapshot() { return status; }

/** Hold the browser-engine lease while `want` is true; returns the live status.
 * Consumers should gate their engine calls on `status === 'active'`. */
export function useEngineLease(want: boolean): LeaseStatus {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    if (!want) return;
    retainEngine();
    return releaseEngine;
  }, [want]);
  return want ? current : 'idle';
}
