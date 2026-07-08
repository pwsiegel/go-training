// Hardware-adaptive GPU batch sizing. A WebGPU forward pass monopolizes the GPU
// for its whole duration, so an oversized batch means long dispatches that
// starve the compositor (spinner jank) and inflate peak VRAM. We instead size
// each dispatch to a fixed time budget, measured per-net per-device at load.
//
// Throughput plateaus by batch ~8-16, so past the plateau a bigger batch only
// adds latency and memory with no gain — hence the [MIN, MAX] clamp.

export type EnginePerf = {
  // Value-only forward-pass wall time at a couple of batch sizes, measured on
  // the active backend right after the net loads (steady state, shaders warm).
  points: { batch: number; ms: number }[];
};

// ~80 ms/dispatch keeps a ~12 fps floor for the compositor during a search.
export const TARGET_DISPATCH_MS = 80;
export const MIN_BATCH = 2;
export const MAX_BATCH = 16;
// Used when no measurement is available yet (first analysis before the probe,
// or a non-WebGPU backend) — a safe middle of the plateau.
export const FALLBACK_BATCH = 8;

/** Batch size whose forward-pass dispatch is ~`targetMs`, from a linear fit
 * (dispatch(b) = fixed + b·marginal) through the measured points. Clamped to
 * the useful [MIN, MAX] range. */
export function autoBatchSize(
  perf: EnginePerf | null | undefined,
  opts: { targetMs?: number; min?: number; max?: number } = {},
): number {
  const target = opts.targetMs ?? TARGET_DISPATCH_MS;
  const min = opts.min ?? MIN_BATCH;
  const max = opts.max ?? MAX_BATCH;

  const pts = perf?.points;
  if (!pts || pts.length < 2) return Math.max(min, Math.min(max, FALLBACK_BATCH));

  const [lo, hi] = pts[0].batch <= pts[1].batch ? [pts[0], pts[1]] : [pts[1], pts[0]];
  const span = hi.batch - lo.batch;
  const marginal = span > 0 ? (hi.ms - lo.ms) / span : 0;
  if (!(marginal > 0)) return max; // flat/degenerate curve — GPU has headroom

  const fixed = lo.ms - marginal * lo.batch;
  const raw = Math.round((target - fixed) / marginal);
  return Math.max(min, Math.min(max, raw));
}
