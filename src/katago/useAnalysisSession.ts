// Session-style analysis: the app-level model is "I am standing on a position;
// stream me its evaluation as it deepens," not "run N playouts and reply".
//
// One streaming analyze call per (position, target): the browser worker keeps
// its search tree between calls (reuseTree) and re-roots it when navigating one
// ply forward (parentPositionId), so raising the target — the ponder button —
// just continues the same search, and snapshots arrive continuously via the
// worker's periodic reports. The native backend streams the same way through
// its GTP session bridge (/api/katago/session, kata-analyze underneath), whose
// engine likewise keeps its tree across play/undo position changes.
import { useEffect, useRef, useState } from 'react';
import {
  analyzePosition, emptyPointsIn, mapBackend,
  type AnalysisModel, type AnalyzeArgs, type WebAnalysis,
} from './webEngine';
import { streamNativeAnalysis } from '../data/katagoSession';
import type { Color, Stone } from '../types';
import type { GameMove } from '../data/model';

export type SessionPosition = {
  positionId: string;
  parentPositionId?: string;
  stones: Stone[];
  previousStones?: Stone[];
  previousPreviousStones?: Stone[];
  initialStones?: Stone[];
  moves: GameMove[];
  toPlay: Color;
  region?: AnalyzeArgs['region'];
  evalNext?: AnalyzeArgs['evalNext'];
};

/** A search target rather than a budget: sessions run until they reach it, and
 * raising it continues the same search. Effectively "ponder". */
export const PONDER_TARGET = 50_000;

export function useAnalysisSession(args: {
  enabled: boolean;
  model: AnalysisModel;
  position: SessionPosition | null;
  targetVisits: number;
  batchSize?: number;
  debounceMs?: number;   // absorb rapid navigation (default 250ms)
}): { snapshot: WebAnalysis | null; error: string; running: boolean } {
  const { enabled, model, position, targetVisits, batchSize } = args;
  const [snap, setSnap] = useState<{ forId: string; data: WebAnalysis } | null>(null);
  const [error, setError] = useState('');
  const [inFlight, setInFlight] = useState(false);
  // One-time played-move eval per position (streamed snapshots carry it once known).
  const playedEvalRef = useRef<{ forId: string; value: WebAnalysis['playedEval'] } | null>(null);

  const regionKey = position?.region
    ? `${position.region.colMin},${position.region.colMax},${position.region.rowMin},${position.region.rowMax}`
    : '';

  useEffect(() => {
    if (!enabled || !position) return;
    const pos = position;
    let active = true;

    const withPlayedEval = (a: WebAnalysis): WebAnalysis => {
      if (!pos.evalNext) return a;
      const nm = pos.evalNext.move;
      const cand = a.moves.find((m) => m.x === nm.x && m.y === nm.y);
      if (cand) return { ...a, playedEval: { scoreLead: cand.scoreLead, pointsLost: cand.pointsLost } };
      const cached = playedEvalRef.current;
      if (cached && cached.forId === pos.positionId) return { ...a, playedEval: cached.value };
      return a;
    };

    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      setInFlight(true);
      setError('');
      if (model.kind === 'local') {
        // Native session: NDJSON stream from the backend's GTP engine; the
        // one-time played-move eval isn't available here, so playedEval is
        // candidate-derived only.
        streamNativeAnalysis({
          initialStones: pos.initialStones ?? [],
          moves: pos.moves,
          toPlay: pos.toPlay,
          maxVisits: targetVisits,
          allowMoves: pos.region ? emptyPointsIn(pos.region, pos.stones) : null,
          signal: ctrl.signal,
          onReport: (report) => {
            if (!active || !report.root) return;
            setSnap({ forId: pos.positionId, data: withPlayedEval(mapBackend(report, pos.toPlay)) });
          },
        })
          .then(() => { if (active) setInFlight(false); })
          .catch((e) => {
            if (!active || ctrl.signal.aborted) return;
            setInFlight(false);
            setError(e instanceof Error ? e.message : 'analysis failed');
          });
        return;
      }
      analyzePosition({
        model,
        stones: pos.stones,
        previousStones: pos.previousStones,
        previousPreviousStones: pos.previousPreviousStones,
        initialStones: pos.initialStones,
        moves: pos.moves,
        toPlay: pos.toPlay,
        positionId: pos.positionId,
        parentPositionId: pos.parentPositionId,
        region: pos.region,
        visits: targetVisits,
        maxTimeMs: 290_000,
        reuseTree: true,
        batchSize,
        evalNext: pos.evalNext,
        onProgress: (p) => {
          if (active) setSnap({ forId: pos.positionId, data: withPlayedEval(p) });
        },
      })
        .then((res) => {
          if (!active) return;
          setInFlight(false);
          if (res === null) return;   // superseded by a newer session call — benign
          if (res.playedEval !== undefined && pos.evalNext) {
            playedEvalRef.current = { forId: pos.positionId, value: res.playedEval };
          }
          setSnap({ forId: pos.positionId, data: withPlayedEval(res) });
        })
        .catch((e) => {
          if (!active) return;
          setInFlight(false);
          setError(e instanceof Error ? e.message : 'analysis failed');
        });
    }, args.debounceMs ?? 250);
    return () => { active = false; ctrl.abort(); window.clearTimeout(timer); };
    // Position identity is (positionId, region); the boards/moves are derived.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, model, position?.positionId, regionKey, targetVisits, batchSize]);

  const snapshot = snap && position && snap.forId === position.positionId ? snap.data : null;
  const running = enabled && !!position && !error && (inFlight || !snapshot);
  return { snapshot, error, running };
}
