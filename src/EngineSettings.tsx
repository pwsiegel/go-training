import { recommendedBatchSize, activeBatchSize, type AnalysisModel } from './katago/webEngine';
import './EngineSettings.css';

/** Shared analysis-engine settings, used by Review and Explore: model picker
 * with per-model playouts, and the GPU batch (Auto with a manual override). */
export function EngineSettings({
  models, modelId, onModelId, visitsByModel, onVisitsChange, batchOverride, onBatchOverride,
}: {
  models: AnalysisModel[];
  modelId: string;
  onModelId: (id: string) => void;
  visitsByModel: Record<string, number>;
  onVisitsChange: (id: string, visits: number) => void;
  batchOverride: number | null;
  onBatchOverride: (batch: number | null) => void;
}) {
  const autoBatch = activeBatchSize() ?? recommendedBatchSize();
  const clampInt = (v: string) => Math.max(1, Math.floor(Number(v) || 1));

  return (
    <div className="engine-settings">
      <div className="es-head">Model</div>
      {models.map((m) => {
        const visits = visitsByModel[m.id] ?? m.defaultVisits;
        return (
          <label key={m.id} className={m.id === modelId ? 'es-model active' : 'es-model'}>
            <input
              type="radio"
              name="engine-model"
              checked={m.id === modelId}
              onChange={() => onModelId(m.id)}
            />
            <span className="es-model-main">
              <span className="es-model-name">{m.name}</span>
              <span className="es-model-sub">{m.runtime} · {m.strength}</span>
            </span>
            <input
              type="number"
              className="es-num"
              min={1}
              value={visits}
              onChange={(e) => onVisitsChange(m.id, clampInt(e.target.value))}
              aria-label={`${m.name} playouts`}
            />
            <span className="es-num-label">playouts</span>
            {visits !== m.defaultVisits && (
              <button
                type="button"
                className="es-reset"
                onClick={() => onVisitsChange(m.id, m.defaultVisits)}
                title={`Reset to ${m.defaultVisits}`}
                aria-label={`Reset ${m.name} playouts to default (${m.defaultVisits})`}
              >
                ↺
              </button>
            )}
          </label>
        );
      })}

      <div className="es-head">GPU batch</div>
      <div className="es-batch">
        {batchOverride === null ? (
          <>
            <span className="es-batch-auto">Auto — {autoBatch} / pass</span>
            <button
              type="button"
              className="es-reset"
              onClick={() => onBatchOverride(autoBatch)}
              title="Set a manual batch size"
              aria-label="Override the automatic batch size"
            >
              ✎
            </button>
          </>
        ) : (
          <>
            <input
              type="number"
              className="es-num"
              min={1}
              value={batchOverride}
              onChange={(e) => onBatchOverride(clampInt(e.target.value))}
              aria-label="Manual GPU batch size"
            />
            <span className="es-num-label">positions / pass</span>
            <button
              type="button"
              className="es-reset"
              onClick={() => onBatchOverride(null)}
              title="Back to Auto"
              aria-label="Reset batch size to Auto"
            >
              ↺
            </button>
          </>
        )}
      </div>
      <p className="es-note">Auto sizes each GPU pass to a latency budget. Lower it manually if a big GPU allocation fails.</p>
    </div>
  );
}
