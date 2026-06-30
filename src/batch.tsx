import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { listBatch } from './data/study';
import type { AttemptDoc } from './data/model';

type BatchValue = { batch: AttemptDoc[]; refresh: () => void };

const BatchContext = createContext<BatchValue>({ batch: [], refresh: () => {} });

// eslint-disable-next-line react-refresh/only-export-components
export function useBatch() { return useContext(BatchContext); }

/** Holds the current draft batch (latest unsent attempt per problem) so the
 * batch drawer stays in sync as problems are saved/removed across views.
 * Re-fetches on navigation; the solver also calls refresh() after saving. */
export function BatchProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  const [batch, setBatch] = useState<AttemptDoc[]>([]);

  const refresh = useCallback(() => {
    if (user) listBatch(user.uid).then(setBatch).catch(() => {});
  }, [user]);

  useEffect(refresh, [refresh, location.pathname]);

  return <BatchContext.Provider value={{ batch, refresh }}>{children}</BatchContext.Provider>;
}
