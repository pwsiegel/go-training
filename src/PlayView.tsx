import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Board, type Annotation } from './Board';
import { Spinner } from './Spinner';
import { playMove, type PlayError } from './goRules';
import type { Color, Stone } from './types';
import './PlayView.css';
import { type Region } from './data/katago';
import { analyzePosition, BROWSER_MODELS, LOCAL_MODEL, type WebAnalysis } from './katago/webEngine';
import { useModelPreference } from './katago/useModelPreference';
import { Modal } from './Modal';
import { EngineSettings } from './EngineSettings';
import { useEngineLease } from './katago/engineLease';

type Tool = 'play' | 'addB' | 'addW' | 'region' | 'number' | 'letter' | 'triangle' | 'square';

type Move = { color: Color; x: number; y: number };

const ERROR_MESSAGES: Record<PlayError, string> = {
  occupied: 'Occupied.',
  suicide: 'Suicide is not allowed.',
  ko: 'Ko: cannot recapture here yet.',
  'out-of-bounds': 'Out of bounds.',
};

function letterAt(n: number): string {
  let s = '';
  let m = n;
  while (true) {
    s = String.fromCharCode(65 + (m % 26)) + s;
    m = Math.floor(m / 26) - 1;
    if (m < 0) break;
  }
  return s;
}

function replayHistory(initial: Stone[], history: Move[]) {
  let stones = initial;
  let koPoint: { x: number; y: number } | null = null;
  for (const h of history) {
    const r = playMove(stones, h.color, h.x, h.y, koPoint);
    if (!r.ok) break;
    stones = r.stones;
    koPoint = r.koPoint;
  }
  return { stones, koPoint };
}

/** Interactive play mode for a problem. Lets the user play legal moves
 * (Black always starts, alternating thereafter — see roadmap) with
 * capture and simple-ko enforcement, plus an annotation tool palette
 * (number, letter, triangle, square). State is in-memory only and
 * survives toggling between solve and play within the same problem
 * because the parent keeps this component mounted. */
export function PlayView({
  initialStones,
  viewport,
}: {
  initialStones: Stone[];
  /** Optional zoom rectangle, same shape as Board's viewport. */
  viewport?: { colMin: number; colMax: number; rowMin: number; rowMax: number };
}) {
  const [tool, setTool] = useState<Tool>('play');
  const [history, setHistory] = useState<Move[]>([]);
  // Editable board base (manual "add stones" edits). Play moves replay on top.
  const [baseStones, setBaseStones] = useState<Stone[]>(initialStones);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [numCounter, setNumCounter] = useState(1);
  const [letterCounter, setLetterCounter] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [aiOn, setAiOn] = useState(false);
  const [aiResult, setAiResult] = useState<{ key: string; data?: WebAnalysis; error?: string } | null>(null);
  const [region, setRegion] = useState<Region | null>(null);
  const [regionAnchor, setRegionAnchor] = useState<{ x: number; y: number } | null>(null);
  const { models, model, modelId, pickModel } = useModelPreference();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [visitsByModel, setVisitsByModel] = useState<Record<string, number>>(
    () => Object.fromEntries([...BROWSER_MODELS, LOCAL_MODEL].map((m) => [m.id, m.defaultVisits])),
  );
  // GPU dispatch batch: null = Auto (engine sizes to a latency budget), else manual.
  const [batchOverride, setBatchOverride] = useState<number | null>(null);

  // The browser engine is single-instance across tabs/windows (see engineLease).
  const engineStatus = useEngineLease(aiOn && model.kind === 'browser');
  const engineReady = model.kind !== 'browser' || engineStatus === 'active';

  const { stones, koPoint } = useMemo(
    () => replayHistory(baseStones, history),
    [baseStones, history],
  );
  const nextColor: Color = history.length % 2 === 0 ? 'B' : 'W';

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 1800);
    return () => clearTimeout(t);
  }, [error]);

  // Key the analysis on the actual query inputs — setup + moves (so ko/superko
  // differences register) + region + side to move.
  const posKey = useMemo(() => {
    const r = region
      ? `${region.colMin},${region.colMax},${region.rowMin},${region.rowMax}` : 'full';
    const b = baseStones.map((s) => `${s.x},${s.y}${s.color}`).join(';');
    const h = history.map((m) => `${m.color}${m.x},${m.y}`).join(';');
    return `${model.id}|${nextColor}|${r}|${b}|${h}`;
  }, [baseStones, history, region, nextColor, model.id]);

  useEffect(() => {
    if (!aiOn || !engineReady) return;
    const ctrl = new AbortController();
    let active = true;
    analyzePosition({
      model,
      stones,
      initialStones: baseStones,
      moves: history,
      toPlay: nextColor,
      positionId: posKey,
      visits: visitsByModel[model.id] ?? model.defaultVisits,
      batchSize: batchOverride ?? undefined,
      region,
      signal: ctrl.signal,
    })
      .then((a) => { if (active && a) setAiResult({ key: posKey, data: a }); })
      .catch((e) => {
        if (!active || ctrl.signal.aborted) return;
        setAiResult({
          key: posKey,
          error: model.kind === 'local'
            ? 'KataGo backend offline — is `make api` running?'
            : (e instanceof Error ? e.message : 'analysis failed'),
        });
      });
    return () => { active = false; ctrl.abort(); };
  }, [aiOn, engineReady, model, posKey, stones, baseStones, history, nextColor, region, visitsByModel, batchOverride]);

  // Use the result only if it's for the current position; else we're still loading.
  const current = aiOn && aiResult?.key === posKey ? aiResult : null;
  const analysis = current?.data ?? null;
  const aiError = current?.error ?? null;
  const aiLoading = aiOn && engineReady && !current && !aiError;

  // Near-optimal moves: within ~½ point of the best, ignoring low-visit noise.
  // WebAnalysis carries side-to-move pointsLost (best = 0) already.
  const aiCandidates = useMemo(() => {
    if (!analysis) return undefined;
    // Near-optimal moves first; the visit floor only rejects single-visit score
    // noise and scales to the search size — Explore runs few visits, so a fixed
    // floor would hide every move. Always keep the best so a completed analysis
    // never shows an empty board.
    const near = analysis.moves.filter((m) => m.pointsLost <= 0.5);
    const floor = Math.max(2, analysis.rootVisits * 0.03);
    const solid = near.filter((m) => m.visits >= floor);
    return (solid.length ? solid : near.slice(0, 1)).map((m) => ({ x: m.x, y: m.y, loss: m.pointsLost }));
  }, [analysis]);

  // Root score/winrate are Black's perspective — read off who's ahead directly.
  const blackLead = analysis ? analysis.rootScoreLead : 0;
  const blackWinrate = analysis ? analysis.rootWinrate : 0;
  const aiEval = analysis
    ? {
        leader: blackLead >= 0 ? 'Black' : 'White',
        lead: Math.abs(blackLead),
        winrate: blackLead >= 0 ? blackWinrate : 1 - blackWinrate,
      }
    : null;

  const handleCellClick = (x: number, y: number) => {
    if (tool === 'addB' || tool === 'addW') {
      const color: Color = tool === 'addB' ? 'B' : 'W';
      const here = stones.find((s) => s.x === x && s.y === y);
      const without = stones.filter((s) => !(s.x === x && s.y === y));
      // Same color → remove; empty or opposite color → place the selected color.
      const next = here && here.color === color ? without : [...without, { x, y, color }];
      setBaseStones(next.map((s) => ({ x: s.x, y: s.y, color: s.color })));
      setHistory([]);
      return;
    }
    if (tool === 'region') {
      if (regionAnchor === null) {
        setRegionAnchor({ x, y });
        setRegion(null);
      } else {
        setRegion({
          colMin: Math.min(regionAnchor.x, x), colMax: Math.max(regionAnchor.x, x),
          rowMin: Math.min(regionAnchor.y, y), rowMax: Math.max(regionAnchor.y, y),
        });
        setRegionAnchor(null);
        setAiOn(true);    // region is only useful with AI hints on
        setTool('play');  // region stays active until cleared; clicks now play
      }
      return;
    }
    if (tool === 'play') {
      const r = playMove(stones, nextColor, x, y, koPoint);
      if (!r.ok) {
        setError(ERROR_MESSAGES[r.error]);
        return;
      }
      setHistory((h) => [...h, { color: nextColor, x, y }]);
      return;
    }
    const existingIdx = annotations.findIndex((a) => a.x === x && a.y === y);
    if (existingIdx >= 0) {
      setAnnotations((arr) => arr.filter((_, i) => i !== existingIdx));
      return;
    }
    if (tool === 'number') {
      setAnnotations((arr) => [...arr, { kind: 'label', x, y, text: String(numCounter) }]);
      setNumCounter((n) => n + 1);
    } else if (tool === 'letter') {
      setAnnotations((arr) => [...arr, { kind: 'label', x, y, text: letterAt(letterCounter) }]);
      setLetterCounter((n) => n + 1);
    } else if (tool === 'triangle') {
      setAnnotations((arr) => [...arr, { kind: 'triangle', x, y }]);
    } else if (tool === 'square') {
      setAnnotations((arr) => [...arr, { kind: 'square', x, y }]);
    }
  };

  const undo = () => {
    if (history.length === 0) return;
    setHistory((h) => h.slice(0, -1));
  };

  const reset = () => {
    setHistory([]);
    setBaseStones(initialStones);
    setAnnotations([]);
    setNumCounter(1);
    setLetterCounter(0);
    setTool('play');
    setError(null);
    setRegion(null);
    setRegionAnchor(null);
  };

  const clearRegion = () => {
    setRegion(null);
    setRegionAnchor(null);
  };

  return (
    <div className="play-view">
      <div className="play-board">
        <Board
          stones={stones}
          annotations={annotations}
          viewport={viewport}
          onCellClick={handleCellClick}
          aiCandidates={aiOn ? aiCandidates : undefined}
          region={region}
          regionAnchor={tool === 'region' ? regionAnchor : null}
        />
        <div className="play-status">
          {error
            ? <span className="play-error">{error}</span>
            : tool === 'addB'
              ? <span>Click to add or remove black stones</span>
              : tool === 'addW'
                ? <span>Click to add or remove white stones</span>
                : tool === 'region'
                  ? <span>{regionAnchor ? 'Click the opposite corner' : 'Click two corners to bound the AI region'}</span>
                  : <span>{nextColor === 'B' ? 'Black' : 'White'} to play</span>}
        </div>
        {aiOn && (
          <div className="play-status">
            {engineStatus === 'waiting'
              ? <span className="play-ai-wait">KataGo AI is running in another tab or window — turn it off there (or close it) to use it here.</span>
              : aiError
                ? <span className="play-error">{aiError}</span>
                : aiEval
                  ? <span>KataGo: {aiEval.leader === 'Black' ? 'B' : 'W'}+{aiEval.lead.toFixed(1)} · {(aiEval.winrate * 100).toFixed(0)}%</span>
                  : aiLoading ? <Spinner label="Analyzing…" /> : null}
          </div>
        )}
      </div>
      <div className="play-tools" role="toolbar" aria-label="Play mode tools">
        <div className="play-ai-row">
          <ToolButton active={aiOn} onClick={() => setAiOn((v) => !v)}>
            AI hints <span className="tool-counter">{aiLoading ? '…' : aiOn ? 'on' : 'off'}</span>
          </ToolButton>
          <button
            type="button"
            className="play-tool play-gear"
            onClick={() => setSettingsOpen(true)}
            aria-label="Analysis settings"
            title="Analysis settings"
          >
            ⚙
          </button>
        </div>
        <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Analysis settings">
          <EngineSettings
            models={models}
            modelId={modelId}
            onModelId={pickModel}
            visitsByModel={visitsByModel}
            onVisitsChange={(id, v) => setVisitsByModel((prev) => ({ ...prev, [id]: v }))}
            batchOverride={batchOverride}
            onBatchOverride={setBatchOverride}
          />
        </Modal>
        <ToolButton active={tool === 'region'} onClick={() => { setAiOn(true); setTool('region'); }}>
          Region <span className="tool-counter">{region ? 'set' : 'off'}</span>
        </ToolButton>
        {region && (
          <button type="button" className="play-tool" onClick={clearRegion}>Clear region</button>
        )}
        <div className="play-tools-divider" />
        <ToolButton active={tool === 'play'} onClick={() => setTool('play')}>Play</ToolButton>
        <ToolButton active={tool === 'addB'} onClick={() => setTool('addB')}>Add black stones</ToolButton>
        <ToolButton active={tool === 'addW'} onClick={() => setTool('addW')}>Add white stones</ToolButton>
        <ToolButton active={tool === 'number'} onClick={() => setTool('number')}>
          Number <span className="tool-counter">{numCounter}</span>
        </ToolButton>
        <ToolButton active={tool === 'letter'} onClick={() => setTool('letter')}>
          Letter <span className="tool-counter">{letterAt(letterCounter)}</span>
        </ToolButton>
        <ToolButton active={tool === 'triangle'} onClick={() => setTool('triangle')}>
          <span aria-hidden>△</span> Triangle
        </ToolButton>
        <ToolButton active={tool === 'square'} onClick={() => setTool('square')}>
          <span aria-hidden>□</span> Square
        </ToolButton>
        <div className="play-tools-divider" />
        <button
          type="button"
          className="play-tool"
          onClick={undo}
          disabled={history.length === 0}
        >
          Undo
        </button>
        <button type="button" className="play-tool" onClick={reset}>
          Reset
        </button>
      </div>
    </div>
  );
}

function ToolButton({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className={active ? 'play-tool active' : 'play-tool'}
      onClick={onClick}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}
