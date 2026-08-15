import {
  recommendedBatchSize, activeBatchSize, HUMAN_ENGINES, HUMAN_RANKS,
  type AnalysisModel,
} from './katago/webEngine';
import type { PlayDefaults } from './data/model';
import './EngineSettings.css';

const clampInt = (v: string) => Math.max(1, Math.floor(Number(v) || 1));

/** Analysis-engine settings: the model reviewing positions, its playouts, and
 * the GPU batch (Auto with a manual override). */
export function AnalysisSettings({
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

  return (
    <section className="engine-settings">
      <h3 className="es-section">Analysis</h3>
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
    </section>
  );
}

/** Human-like opponent settings: the net that plays, how strong and how sharp
 * it is, its pace, and how much of the score you're shown while playing. Every
 * one of them applies immediately, mid-game included. */
export function PlaySettings({
  play, onChange, localAvailable,
}: {
  play: PlayDefaults;
  onChange: (patch: Partial<PlayDefaults>) => void;
  localAvailable: boolean;
}) {
  const engines = HUMAN_ENGINES.filter((e) => e.id === 'browser' || localAvailable);

  return (
    <section className="engine-settings">
      <h3 className="es-section">Play</h3>
      <div className="es-head">Opponent</div>
      {engines.map((e) => (
        <label key={e.id} className={play.engine === e.id ? 'es-model active' : 'es-model'}>
          <input
            type="radio"
            name="play-engine"
            checked={play.engine === e.id}
            onChange={() => onChange({ engine: e.id })}
          />
          <span className="es-model-main">
            <span className="es-model-name">{e.name}</span>
            <span className="es-model-sub">{e.runtime}</span>
          </span>
        </label>
      ))}

      <label className="es-field">
        <span>Rank</span>
        <select value={play.rank} onChange={(e) => onChange({ rank: e.target.value })}>
          {HUMAN_RANKS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </label>

      <label className="es-field">
        <span>Sharpness <small>{play.temperature.toFixed(2)}</small></span>
        <input
          type="range" min={0.2} max={1.0} step={0.05}
          value={play.temperature}
          onChange={(e) => onChange({ temperature: Number(e.target.value) })}
        />
        <small className="es-hint">1.0 plays like the rank; lower is sharper and stronger.</small>
      </label>

      <label className="es-field">
        <span>Move delay <small>{play.moveDelay.toFixed(2)}s</small></span>
        <input
          type="range" min={0} max={3} step={0.25}
          value={play.moveDelay}
          onChange={(e) => onChange({ moveDelay: Number(e.target.value) })}
        />
        <small className="es-hint">Minimum pause before the opponent replies.</small>
      </label>

      <div className="es-field">
        <span>Score</span>
        <div className="es-seg" role="group" aria-label="Score display">
          {(['show', 'hide', 'alert'] as const).map((m) => (
            <button key={m} type="button" className={play.scoreMode === m ? 'active' : ''}
              onClick={() => onChange({ scoreMode: m })}>
              {m === 'show' ? 'Show' : m === 'hide' ? 'Hide' : 'Alert'}
            </button>
          ))}
        </div>
        {play.scoreMode === 'alert' && (
          <>
            <label className="es-thresh">
              <input type="radio" name="alert-kind" checked={play.alertKind !== 'drop'}
                onChange={() => onChange({ alertKind: 'behind' })} />
              Alert when behind by{' '}
              <input
                type="number" min={1}
                value={play.alertThreshold}
                onChange={(e) => onChange({ alertThreshold: clampInt(e.target.value) })}
              />{' '}points.
            </label>
            <label className="es-thresh">
              <input type="radio" name="alert-kind" checked={play.alertKind === 'drop'}
                onChange={() => onChange({ alertKind: 'drop' })} />
              Alert when{' '}
              <input
                type="number" min={1}
                value={play.dropPoints ?? 5}
                onChange={(e) => onChange({ dropPoints: clampInt(e.target.value) })}
              />{' '}points are lost over the last{' '}
              <input
                type="number" min={2}
                value={play.dropMoves ?? 10}
                onChange={(e) => onChange({ dropMoves: Math.max(2, clampInt(e.target.value)) })}
              />{' '}moves.
            </label>
          </>
        )}
      </div>
    </section>
  );
}
