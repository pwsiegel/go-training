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
  analyzePosition, emptyPointsIn, evalPlayedMove, mapBackend,
  type AnalysisModel, type AnalyzeArgs, type WebAnalysis,
} from './webEngine';
import { getKataGoEngineClient } from './engine/katago/client';
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
  // Opaque to this hook: echoed back with every snapshot so the caller can
  // attribute a streamed result to whatever it was analyzing.
  nodeId?: number;
  nodeKey?: string;
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
  // Called as each snapshot arrives, with the position it was computed for.
  // Lets a caller record results where they land instead of in an effect.
  onSnapshot?: (analysis: WebAnalysis, position: SessionPosition) => void;
}): { snapshot: WebAnalysis | null; error: string; running: boolean } {
  const { enabled, model, position, targetVisits, batchSize } = args;
  const [snap, setSnap] = useState<{ forId: string; data: WebAnalysis } | null>(null);
  const [error, setError] = useState('');
  const [inFlight, setInFlight] = useState(false);
  // One-time played-move eval per position (streamed snapshots carry it once known).
  const playedEvalRef = useRef<{ forId: string; value: WebAnalysis['playedEval'] } | null>(null);
  // Latest callback, so a running search always reports to the current render.
  const onSnapshotRef = useRef(args.onSnapshot);
  useEffect(() => { onSnapshotRef.current = args.onSnapshot; });

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

    const emit = (data: WebAnalysis) => {
      setSnap({ forId: pos.positionId, data });
      onSnapshotRef.current?.(data, pos);
    };

    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      setInFlight(true);
      setError('');
      if (model.kind === 'local') {
        // Native session: NDJSON stream from the backend's GTP engine. The
        // stream can't eval an arbitrary unsearched move, so when the played
        // move is missing from the candidates it gets a one-time probe via the
        // one-off analyze endpoint — the played move always carries an eval.
        let probing = false;
        streamNativeAnalysis({
          initialStones: pos.initialStones ?? [],
          moves: pos.moves,
          toPlay: pos.toPlay,
          maxVisits: targetVisits,
          allowMoves: pos.region ? emptyPointsIn(pos.region, pos.stones) : null,
          signal: ctrl.signal,
          onReport: (report) => {
            if (!active || !report.root) return;
            const mapped = mapBackend(report, pos.toPlay);
            emit(withPlayedEval(mapped));
            const nm = pos.evalNext?.move;
            if (!nm || probing) return;
            if (playedEvalRef.current?.forId === pos.positionId) return;
            if (mapped.moves.some((m) => m.x === nm.x && m.y === nm.y)) return;
            probing = true;
            evalPlayedMove({
              model,
              stones: pos.stones,
              initialStones: pos.initialStones,
              moves: pos.moves,
              toPlay: pos.toPlay,
              positionId: pos.positionId,
              visits: targetVisits,
              evalNext: pos.evalNext,
              signal: ctrl.signal,
            }, mapped).then((value) => {
              if (!active || !value) return;
              playedEvalRef.current = { forId: pos.positionId, value };
              emit(withPlayedEval(mapped));
            });
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
          if (active) emit(withPlayedEval(p));
        },
      })
        .then((res) => {
          if (!active) return;
          setInFlight(false);
          if (res === null) return;   // superseded by a newer session call — benign
          if (res.playedEval !== undefined && pos.evalNext) {
            playedEvalRef.current = { forId: pos.positionId, value: res.playedEval };
          }
          emit(withPlayedEval(res));
        })
        .catch((e) => {
          if (!active) return;
          setInFlight(false);
          setError(e instanceof Error ? e.message : 'analysis failed');
        });
    }, args.debounceMs ?? 250);
    return () => {
      active = false;
      ctrl.abort();
      window.clearTimeout(timer);
      // Actually stop the worker's search (there is no per-request cancel):
      // without this, leaving review keeps a pondering search running for
      // minutes and anything queued behind it — a Play genmove — hangs. On
      // navigation the next analyze re-roots the kept tree as before.
      if (model.kind !== 'local') getKataGoEngineClient().cancelAnalyses();
    };
    // Position identity is (positionId, region); the boards/moves are derived.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, model, position?.positionId, regionKey, targetVisits, batchSize]);

  const snapshot = snap && position && snap.forId === position.positionId ? snap.data : null;
  const running = enabled && !!position && !error && (inFlight || !snapshot);
  return { snapshot, error, running };
}
