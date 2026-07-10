import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BROWSER_MODELS, LOCAL_MODEL, FALLBACK_MODEL_ID, webgpuAvailable,
} from './webEngine';
import { katagoBackendAvailable } from '../data/katago';
import { setEnginePrefs } from '../data/profile';
import { useAuth } from '../auth';

const DEFAULT_MODEL_ID = BROWSER_MODELS[0].id;   // b18
const isBrowserModel = (id?: string) => !!id && BROWSER_MODELS.some((m) => m.id === id);

/** Analysis-model selection for Review and Explore, persisted to the user's
 * profile (`enginePrefs`) so a change on either surface carries to the other and
 * across sessions. The native GPU backend is only offered in local dev, so the
 * choice made when it's reachable is tracked separately from the browser one:
 * writes target whichever context is active now, and reads resolve by it. */
export function useModelPreference() {
  const { user, profile, updateProfile } = useAuth();
  const [localAvailable, setLocalAvailable] = useState<boolean | null>(null); // null = unchecked
  const [webgpuOk, setWebgpuOk] = useState<boolean | null>(null);
  const [modelId, setModelId] = useState(DEFAULT_MODEL_ID);
  const userPicked = useRef(false);   // an explicit pick this mount always wins

  const localOk = localAvailable === true;
  const models = useMemo(
    () => (localOk ? [...BROWSER_MODELS, LOCAL_MODEL] : BROWSER_MODELS),
    [localOk],
  );
  const model = models.find((m) => m.id === modelId) ?? models[0];

  useEffect(() => {
    let on = true;
    katagoBackendAvailable().then((ok) => { if (on) setLocalAvailable(ok); });
    webgpuAvailable().then((ok) => { if (on) setWebgpuOk(ok); });
    return () => { on = false; };
  }, []);

  // Seed from the saved preference once backend availability is known. b18 on the
  // wasm fallback can't search, so with no real WebGPU adapter a browser choice
  // drops to the small b6 net.
  useEffect(() => {
    if (localAvailable === null || userPicked.current) return;
    const saved = localOk ? profile?.enginePrefs?.localModelId : profile?.enginePrefs?.browserModelId;
    const valid = saved === 'local' ? localOk : isBrowserModel(saved);
    let desired = valid ? saved! : DEFAULT_MODEL_ID;
    if (desired !== 'local' && webgpuOk === false) desired = FALLBACK_MODEL_ID;
    setModelId(desired);
  }, [localAvailable, localOk, webgpuOk, profile]);

  const pickModel = (id: string) => {
    userPicked.current = true;
    setModelId(id);
    if (!user) return;
    const next = localOk
      ? { ...profile?.enginePrefs, localModelId: id }
      : { ...profile?.enginePrefs, browserModelId: id };
    updateProfile({ enginePrefs: next });
    void setEnginePrefs(user.uid, next).catch(() => {});   // best-effort persist
  };

  return { models, model, modelId, localAvailable: localOk, pickModel };
}
