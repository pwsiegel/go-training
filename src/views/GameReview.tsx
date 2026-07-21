import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useLocation } from 'react-router-dom';
import { useAuth } from '../auth';
import { Board, type Annotation } from '../Board';
import { playMove, replay } from '../goRules';
import { movesFromSgf, sgfInfo } from '../sgf';
import { gameOutcome, getGame } from '../data/games';
import { listFoxAccounts } from '../data/fox';
import { loadReview, newReviewId, saveReview } from '../data/reviews';
import type { GameDoc, SavedNode } from '../data/model';
import type { Color, Stone } from '../types';
import {
  addMove, buildTree, depthOf, deserializeVariations, leafOf, movesTo, nodeAtDepth,
  pathIds, pruneSubtree, serializeVariations, variationLines, type GameTree,
} from '../variations';
import { analyzePosition, scoreTrajectory, type WebAnalysis } from '../katago/webEngine';
import { useEngineHub } from '../katago/engineHub';
import { Spinner } from '../Spinner';
import { ReviewGraph } from '../ReviewGraph';
import './GameReview.css';

const COLS = 'ABCDEFGHJKLMNOPQRST';
const coordLabel = (x: number, y: number) => `${COLS[x]}${19 - y}`;
const scoreLabel = (lead: number) => `${lead >= 0 ? 'B' : 'W'}+${Math.abs(lead).toFixed(1)}`;
const other = (c: Color): Color => (c === 'B' ? 'W' : 'B');

type Point = { move: number; lead: number };

/** Most recent recorded estimate at or before `move`, else null. */
function scoreBefore(points: Point[], move: number): number | null {
  let best: number | null = null;
  for (const p of points) {
    if (p.move <= move) best = p.lead; else break;
  }
  return best;
}

export function GameReview() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const { user } = useAuth();
  // A just-played game handed straight to review without saving (router state).
  const previewGame = (location.state as { game?: GameDoc } | null)?.game;
  // Where "← Games" returns — the games-list page you came from, else the list.
  const backTo = (location.state as { from?: string } | null)?.from ?? '/review';
  const [loaded, setLoaded] = useState<{ id: string; game: GameDoc | null } | null>(null);
  const [myUids, setMyUids] = useState<Set<number>>(new Set());
  const [cursor, setCursor] = useState(0);
  const [analyzeOn, setAnalyzeOn] = useState(false);
  const { model, visits, batchOverride, engineReady, leaseStatus } = useEngineHub();
  const [analysis, setAnalysis] = useState<{ cursor: number; data: WebAnalysis } | null>(null);
  // Pondering: while on, re-analyze the current position with doubling visit
  // budgets (browser models continue the same search tree; the native backend
  // recomputes each round). Reset on any position/model/budget change.
  const [ponder, setPonder] = useState(false);
  const [ponderBoost, setPonderBoost] = useState(0);
  const [analysisErr, setAnalysisErr] = useState('');
  const [partialTop, setPartialTop] = useState<{ cursor: number; x: number; y: number } | null>(null);
  // Live score estimates, keyed by tree node id (not move depth) so they survive
  // line switches and a variation reuses the mainline's cached prefix.
  const [analyzedScores, setAnalyzedScores] = useState<Record<number, number>>({});
  // Full per-position KataGo output, keyed `node:model:visits`, so scrubbing back
  // to a seen position is instant. Cleared on Rerun and on game change.
  const analysisCacheRef = useRef<Map<string, WebAnalysis>>(new Map());
  // Settings signature the cached mainline trajectory was computed for — null
  // until it runs, so it runs once per game and thereafter only on Rerun.
  const [trajFor, setTrajFor] = useState<string | null>(null);
  const [trajRunning, setTrajRunning] = useState(false);
  const trajRanRef = useRef(false);          // gate (non-reactive, avoids self-abort)
  const [rerunToken, setRerunToken] = useState(0);   // bump to force a recompute
  // Variation tree. `line` is the leaf that defines the line currently on
  // screen; `cursor` is how far along that line we're at. The tree persists to
  // `reviews/{reviewId}` (owner-only) via a debounced, fire-and-forget writer.
  const [tree, setTree] = useState<GameTree | null>(null);
  const [line, setLine] = useState(0);
  const reviewIdRef = useRef<string | null>(null);
  const reviewCreatedRef = useRef(0);
  const lastSavedRef = useRef('[]');   // JSON of the last-persisted nodes
  const dirtyRef = useRef<{ json: string; nodes: SavedNode[]; gameId: string; ownerUid: string } | null>(null);
  const saveTimerRef = useRef<number | null>(null);

  // Board square is sized from the content area so the whole review — header,
  // graph, board, controls, move list — fits one screen without page scroll.
  // Below a narrow width the columns stack and the body scrolls internally.
  const [boardSize, setBoardSize] = useState(480);
  const [stacked, setStacked] = useState(false);
  const bodyObs = useRef<ResizeObserver | null>(null);
  const bodyRef = useCallback((el: HTMLDivElement | null) => {
    bodyObs.current?.disconnect();
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      const gap = parseFloat(cs.columnGap) || 20;
      const availW = el.clientWidth - padX;
      const availH = el.clientHeight - padY;
      const stack = availW < 720;
      const side = stack
        ? Math.max(280, Math.min(availW, availH * 0.82, 560))
        : Math.max(300, Math.min(availH, availW - (availW < 1000 ? 320 : 380) - gap, 820));
      setBoardSize(Math.floor(side));
      setStacked(stack);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    bodyObs.current = ro;
  }, []);


  useEffect(() => {
    if (previewGame) return;
    let active = true;
    getGame(id ?? '')
      .then((g) => { if (active) setLoaded({ id: id ?? '', game: g }); })
      .catch(() => { if (active) setLoaded({ id: id ?? '', game: null }); });   // denied / missing → "not found"
    return () => { active = false; };
  }, [id, previewGame]);

  const loading = !previewGame && (!loaded || loaded.id !== id);
  const game = previewGame ?? (loading ? null : loaded?.game ?? null);
  const mainlineMoves = useMemo(() => (game ? movesFromSgf(game.sgf) : []), [game]);

  // Which participant (if any) is one of the game owner's own accounts — for the
  // win/loss accent. Readable by the owner and, per the rules, a linked teacher.
  useEffect(() => {
    if (!game || game.source !== 'fox') return;
    let on = true;
    listFoxAccounts(game.ownerUid)
      .then((a) => { if (on) setMyUids(new Set(a.filter((x) => x.isMine).map((x) => x.uid))); })
      .catch(() => { if (on) setMyUids(new Set()); });
    return () => { on = false; };
  }, [game]);

  // (Re)build the variation tree whenever a different game is shown; start the
  // cursor at the end of the mainline (render-time adjustment, not an effect).
  const [treeForGame, setTreeForGame] = useState<GameDoc | null>(null);
  if (game && game !== treeForGame) {
    setTreeForGame(game);
    const t = buildTree(mainlineMoves);
    setTree(t);
    setLine(t.mainlineLeafId);
    setCursor(mainlineMoves.length);
    setAnalyzedScores({});
    setTrajFor(null);
    setAnalysis(null);
  }

  // Reset per-game refs for a newly-shown game (refs can't be set during render).
  useEffect(() => {
    trajRanRef.current = false;
    analysisCacheRef.current.clear();
  }, [game]);

  // Write any pending variation edit now (debounce fire, unmount, game switch).
  const flush = useCallback(() => {
    if (saveTimerRef.current != null) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    const d = dirtyRef.current;
    if (!d) return;
    dirtyRef.current = null;
    if (!reviewIdRef.current) { reviewIdRef.current = newReviewId(); reviewCreatedRef.current = Date.now(); }
    lastSavedRef.current = d.json;
    saveReview({
      id: reviewIdRef.current, ownerUid: d.ownerUid, gameId: d.gameId,
      nodes: d.nodes, createdAt: reviewCreatedRef.current, updatedAt: Date.now(),
    }).catch(() => { lastSavedRef.current = ' '; /* force a retry on the next edit */ });
  }, []);

  // Load the owner's saved variations for this game, splicing them into the
  // mainline tree. Flush any pending write before switching games. Skipped for
  // preview (just-played, unsaved) games — those stay session-only.
  useEffect(() => {
    if (previewGame || !user || !game) return;
    let active = true;
    const ownerUid = user.uid;
    const gameId = game.id;
    reviewIdRef.current = null;
    reviewCreatedRef.current = 0;
    lastSavedRef.current = '[]';
    loadReview(ownerUid, gameId)
      .then((review) => {
        if (!active || !review) return;
        const restored = deserializeVariations(mainlineMoves, review.nodes);
        reviewIdRef.current = review.id;
        reviewCreatedRef.current = review.createdAt;
        lastSavedRef.current = JSON.stringify(serializeVariations(restored));
        setTree(restored);
      })
      .catch(() => { /* keep the session-only tree on failure */ });
    return () => { active = false; flush(); };
  }, [previewGame, user, game, mainlineMoves, flush]);

  // Debounce a persist whenever the tree gains/loses variation nodes.
  useEffect(() => {
    if (previewGame || !user || !game || !tree) return;
    const nodes = serializeVariations(tree);
    const json = JSON.stringify(nodes);
    if (json === lastSavedRef.current) { dirtyRef.current = null; return; }
    dirtyRef.current = { json, nodes, gameId: game.id, ownerUid: user.uid };
    if (saveTimerRef.current != null) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(flush, 1000);
  }, [tree, previewGame, user, game, flush]);

  // Flush a pending write when leaving the page.
  useEffect(() => flush, [flush]);

  // The moves + node ids along the line currently on screen, and the mainline's.
  const lineMoves = useMemo(() => (tree ? movesTo(tree, line) : []), [tree, line]);
  const lineNodeIds = useMemo(() => (tree ? pathIds(tree, line) : []), [tree, line]);
  const mainNodeIds = useMemo(() => (tree ? pathIds(tree, tree.mainlineLeafId) : []), [tree]);
  const lines = useMemo(() => (tree ? variationLines(tree) : []), [tree]);
  const total = lineMoves.length;
  const onMainline = !!tree && line === tree.mainlineLeafId;
  // Where the current line leaves the mainline (move number after which it
  // diverges); -1 on the mainline itself.
  const branchPoint = useMemo(() => {
    if (!tree || onMainline) return -1;
    const off = lineNodeIds.find((nid) => !tree.nodes[nid].mainline);
    return off != null ? depthOf(tree, off) - 1 : -1;
  }, [tree, lineNodeIds, onMainline]);

  // Score curve for the current line: each depth's node from the (node-keyed)
  // cache, backfilled with recorded mainline scores. The shared prefix of a
  // variation therefore comes straight from the cached mainline analysis.
  const points = useMemo<Point[]>(() => {
    if (!tree) return [];
    const out: Point[] = [];
    for (let i = 0; i <= total; i++) {
      const node = lineNodeIds[i];
      let lead: number | undefined = analyzedScores[node];
      if (lead === undefined && tree.nodes[node]?.mainline) lead = game?.scoreAt?.[String(i)];
      if (lead !== undefined) out.push({ move: i, lead });
    }
    return out;
  }, [tree, lineNodeIds, total, analyzedScores, game]);

  const shown = useMemo(() => replay(lineMoves.slice(0, cursor)), [lineMoves, cursor]);

  // Keep the active move visible by scrolling only the move-list container —
  // never the page (scrollIntoView would drag the whole layout up when the list
  // is near the bottom). Accounts for the sticky header height.
  const activeRef = useRef<HTMLTableRowElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = activeRef.current;
    const box = listRef.current;
    if (!row || !box) return;
    const rowRect = row.getBoundingClientRect();
    const boxRect = box.getBoundingClientRect();
    const headH = box.querySelector('thead')?.getBoundingClientRect().height ?? 0;
    if (rowRect.top < boxRect.top + headH) box.scrollTop -= boxRect.top + headH - rowRect.top;
    else if (rowRect.bottom > boxRect.bottom) box.scrollTop += rowRect.bottom - boxRect.bottom;
  }, [cursor, line]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') setCursor((c) => Math.max(0, c - 1));
      else if (e.key === 'ArrowRight') setCursor((c) => Math.min(total, c + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [total]);

  // Whose turn it is at the cursor: the color of the line's next move if there
  // is one, else the opposite of the last played move (Black on an empty board).
  const toPlay: Color =
    cursor < lineMoves.length ? lineMoves[cursor].color
      : cursor > 0 ? other(lineMoves[cursor - 1].color)
        : 'B';

  useEffect(() => { setPonderBoost(0); }, [line, cursor, model.id, visits]);
  const effVisits = visits * (1 << Math.min(ponderBoost, 8));

  // KataGo analysis of the current position (opt-in). Browser models cancel the
  // stale search via the engine's 'interactive' group; the local backend is
  // canceled via the abort signal when scrubbing to a new position.
  useEffect(() => {
    if (!analyzeOn || !game || !tree || !engineReady) return;
    const forCursor = cursor;
    const forNode = nodeAtDepth(tree, line, cursor);
    const key = `${forNode}:${model.id}:${effVisits}`;
    const moreIfPondering = () => {
      if (ponder && ponderBoost < 8) setPonderBoost(ponderBoost + 1);
    };

    // Cache hit: show it immediately, no recompute (fast scrubbing stays cheap).
    const cached = analysisCacheRef.current.get(key);
    if (cached) {
      setAnalysis({ cursor: forCursor, data: cached });
      setAnalyzedScores((s) => (forNode in s ? s : { ...s, [forNode]: cached.rootScoreLead }));
      setAnalysisErr('');
      moreIfPondering();
      return;
    }

    // Miss: debounce before computing, so holding an arrow key doesn't fire a
    // search for every position scrolled past — only the one you settle on.
    let active = true;
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      const nextMove = cursor < lineMoves.length ? lineMoves[cursor] : null;
      const childStones = nextMove ? replay(lineMoves.slice(0, cursor + 1)).stones : null;
      analyzePosition({
        model,
        stones: shown.stones,
        previousStones: cursor > 0 ? replay(lineMoves.slice(0, cursor - 1)).stones : undefined,
        previousPreviousStones: cursor > 1 ? replay(lineMoves.slice(0, cursor - 2)).stones : undefined,
        moves: lineMoves.slice(0, cursor),
        toPlay,
        positionId: `${id}:${line}:${cursor}:${model.id}`,
        visits: effVisits,
        batchSize: batchOverride ?? undefined,
        signal: ctrl.signal,
        evalNext: nextMove && childStones ? { move: { x: nextMove.x, y: nextMove.y }, stones: childStones } : null,
        onProgress: (p) => {
          if (!active || !p.policyTop) return;
          const top = p.policyTop;
          // Keep the same object when unchanged so the board (and its spinner
          // animation) doesn't re-render on every progress tick.
          setPartialTop((prev) =>
            prev && prev.cursor === forCursor && prev.x === top.x && prev.y === top.y
              ? prev
              : { cursor: forCursor, x: top.x, y: top.y },
          );
        },
      })
        .then((res) => {
          if (!active || res === null) return;
          analysisCacheRef.current.set(key, res);
          setAnalysis({ cursor: forCursor, data: res });
          setAnalyzedScores((s) => ({ ...s, [forNode]: res.rootScoreLead }));
          setAnalysisErr('');
          moreIfPondering();
        })
        .catch((e) => {
          if (!active) return;
          const msg = e instanceof Error ? e.message : 'analysis failed';
          // WebGPU can't allocate this model/position on some GPUs — point at the
          // lighter model / native engine rather than surfacing the raw GPU error.
          const gpuLimit = /createBuffer|GPUDevice|too large|out of memory/i.test(msg);
          setAnalysisErr(gpuLimit
            ? 'this GPU couldn’t run the model here — use a smaller model or reduce batch size (AI engine button in the sidebar)'
            : msg);
        });
    }, 300);
    return () => { active = false; clearTimeout(timer); ctrl.abort(); };
  }, [analyzeOn, engineReady, model, effVisits, ponder, ponderBoost, batchOverride, game, id, tree, line, lineMoves, cursor, shown, toPlay]);

  // Full-game score curve over the (stable) mainline. Runs once per game and
  // fills the node-keyed cache; branching a variation can't abort it (it doesn't
  // depend on the tree), and Rerun re-triggers it from any line. A mainline node's
  // id equals its depth (see buildTree), so scores are keyed by depth directly.
  const trajSig = `${model.id}:${visits}`;
  useEffect(() => {
    if (!analyzeOn || !game || !engineReady) return;
    if (trajRanRef.current) return;   // ran once this game; settings changes use Rerun
    trajRanRef.current = true;
    setTrajFor(trajSig);
    setTrajRunning(true);
    let active = true;
    const ctrl = new AbortController();
    const mlTotal = mainlineMoves.length;
    const boards: Stone[][] = [[]];
    let stones: Stone[] = [];
    let ko: { x: number; y: number } | null = null;
    for (let k = 0; k < mlTotal; k++) {
      const mv = mainlineMoves[k];
      if (mv.x < 0 || mv.y < 0) { boards.push(stones); continue; } // pass
      const r = playMove(stones, mv.color, mv.x, mv.y, ko);
      if (!r.ok) { boards.push(stones); continue; }
      stones = r.stones; ko = r.koPoint;
      boards.push(stones);
    }
    const positions = boards.map((b, k) => ({
      stones: b,
      previousStones: k > 0 ? boards[k - 1] : undefined,
      previousPreviousStones: k > 1 ? boards[k - 2] : undefined,
      moves: mainlineMoves.slice(0, k),
      toPlay: (k < mlTotal ? mainlineMoves[k].color : k > 0 ? other(mainlineMoves[k - 1].color) : 'B') as Color,
    }));
    scoreTrajectory({
      model,
      positions,
      komi: 7.5,
      // Positions per forward pass; omit for Auto (latency-budgeted from the
      // measured forward-pass time). Smaller batches also shrink the peak WebGPU
      // buffer for GPUs that refuse large mappedAtCreation allocations.
      chunk: batchOverride ?? undefined,
      onChunk: (from, scores) => {
        setAnalyzedScores((s) => {
          const next = { ...s };
          scores.forEach((v, j) => { next[from + j] = v; });   // mainline node id === depth
          return next;
        });
      },
      signal: ctrl.signal,
    })
      .catch(() => { trajRanRef.current = false; /* aborted / engine error — allow a later run */ })
      .finally(() => { if (active) setTrajRunning(false); });
    return () => { active = false; ctrl.abort(); };
  }, [analyzeOn, engineReady, game, model, visits, mainlineMoves, batchOverride, rerunToken, trajSig]);

  if (loading) return <div className="center-screen"><Spinner /></div>;
  if (!game || !tree) {
    return (
      <div className="gr">
        <p>Game not found.</p>
        <Link to={backTo}>← Back to games</Link>
      </div>
    );
  }

  const seek = (m: number) => setCursor(Math.max(0, Math.min(total, m)));

  // Play (or re-walk) a move at the cursor — branching a variation when it
  // departs from the line, or advancing when it matches an existing child.
  const playAt = (x: number, y: number) => {
    const legal = playMove(shown.stones, toPlay, x, y, shown.koPoint);
    if (!legal.ok) return;
    const branchNode = nodeAtDepth(tree, line, cursor);
    const { tree: next, childId } = addMove(tree, branchNode, { color: toPlay, x, y });
    const stayOnLine = lineNodeIds.includes(childId);
    setTree(next);
    setLine(stayOnLine ? line : leafOf(next, childId));
    setCursor(depthOf(next, childId));
  };

  // Delete a whole variation branch (a chip's subtree). If the current line ran
  // through it, fall back to the mainline.
  const deleteBranch = (nodeId: number) => {
    const next = pruneSubtree(tree, nodeId);
    setTree(next);
    if (!next.nodes[line]) {
      setLine(next.mainlineLeafId);
      setCursor((c) => Math.min(c, depthOf(next, next.mainlineLeafId)));
    }
  };
  // Recompute the mainline score graph (e.g. after changing model/visits).
  const rerun = () => {
    trajRanRef.current = false;
    analysisCacheRef.current.clear();
    setTrajFor(null);
    setAnalyzedScores({});
    setRerunToken((t) => t + 1);
  };
  const trajStale = trajFor !== null && trajFor !== trajSig;
  const clearLines = () => {
    const t = buildTree(mainlineMoves);
    setTree(t);
    setLine(t.mainlineLeafId);
    setCursor((c) => Math.min(c, mainlineMoves.length));
  };

  // Move-table navigation. Any Game-column click returns to the mainline at that
  // move (collapsing the variation); clicking a variation move seeks within it;
  // a preview chip drills into that line. (Scrub/arrows still move within the
  // current line, so a variation's shared prefix stays viewable without clicks.)
  const goGame = (depth: number) => { setLine(tree.mainlineLeafId); setCursor(depth); };
  const goVar = (depth: number) => setCursor(depth);
  const enterAt = (leafId: number, depth: number) => { setLine(leafId); setCursor(depth); };

  const mark = cursor > 0 ? lineMoves[cursor - 1] : null;
  const annotations: Annotation[] = mark ? [{ kind: 'circle', x: mark.x, y: mark.y }] : [];
  const cursorScore = scoreBefore(points, cursor);
  const info = sgfInfo(game.sgf);
  const outcome = gameOutcome(game, myUids);
  const mainlineTotal = depthOf(tree, tree.mainlineLeafId);
  // Table shape: rows are move numbers; left = mainline, right = the current
  // variation (or, on the mainline, previews of where variations branch off).
  const mainLen = mainNodeIds.length - 1;
  const maxRows = onMainline ? mainLen : Math.max(mainLen, lineMoves.length);
  const activeIsMain = cursor === 0 || !!tree.nodes[lineNodeIds[cursor]]?.mainline;
  // Non-continuation children at the node before row `i` — variations off the
  // mainline (Game view) or sub-variations off the current line (variation view).
  const previewsAt = (i: number): number[] => {
    if (onMainline) {
      const parent = mainNodeIds[i - 1];
      return parent != null ? tree.nodes[parent].children.filter((c) => !tree.nodes[c].mainline) : [];
    }
    if (i - 1 <= branchPoint) return [];   // siblings at/under the branch live in the strip
    const parent = lineNodeIds[i - 1];
    const cont = lineNodeIds[i];
    return parent != null ? tree.nodes[parent].children.filter((c) => c !== cont) : [];
  };
  const moveCell = (node: number, depth: number, active: boolean, showNum: boolean, onClick: () => void) => {
    const m = tree.nodes[node].move;
    if (!m) return null;
    const score = analyzedScores[node]
      ?? (tree.nodes[node].mainline ? game.scoreAt?.[String(depth)] : undefined);
    return (
      <button type="button" className={active ? 'gr-mv active' : 'gr-mv'} onClick={onClick}>
        {showNum && <span className="mv-num">{depth}</span>}
        <span className={`mv-color mv-${m.color}`} aria-hidden />
        <span className="mv-coord">{coordLabel(m.x, m.y)}</span>
        {score !== undefined && <span className="mv-score">{scoreLabel(score)}</span>}
      </button>
    );
  };
  const previewChip = (node: number) => {
    const m = tree.nodes[node].move;
    if (!m) return null;
    return (
      <span key={node} className="gr-mv-preview">
        <button
          type="button"
          className="gr-mv-preview-go"
          onClick={() => enterAt(leafOf(tree, node), depthOf(tree, node))}
          title={`Explore variation ${coordLabel(m.x, m.y)}`}
        >
          <span className={`mv-color mv-${m.color}`} aria-hidden />
          <span className="mv-coord">{coordLabel(m.x, m.y)}</span>
        </button>
        <button
          type="button"
          className="gr-mv-preview-del"
          onClick={() => deleteBranch(node)}
          aria-label={`Delete variation ${coordLabel(m.x, m.y)}`}
          title="Delete this variation"
        >
          ×
        </button>
      </span>
    );
  };
  const when = new Date(game.createdAt).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
  const currentAnalysis = analyzeOn && analysis && analysis.cursor === cursor ? analysis.data : null;
  const running = analyzeOn && !currentAnalysis && !analysisErr;
  const showTop = running && partialTop && partialTop.cursor === cursor ? partialTop : null;
  const playedNext = cursor < total ? lineMoves[cursor] : null;
  const aiCandidates = currentAnalysis
    ? [
        ...currentAnalysis.moves.map((m) => ({ x: m.x, y: m.y, loss: m.pointsLost })),
        // The played move gets its own dot when the search didn't already list it.
        ...(playedNext && currentAnalysis.playedEval
          && !currentAnalysis.moves.some((m) => m.x === playedNext.x && m.y === playedNext.y)
          ? [{ x: playedNext.x, y: playedNext.y, loss: currentAnalysis.playedEval.pointsLost }]
          : []),
      ]
    : undefined;

  // The live-analysis line under the graph — null when there's nothing to show
  // (e.g. at the last move), so the card doesn't reserve an empty row.
  const analysisLine = leaseStatus === 'waiting'
    ? <span className="gr-analyze-wait">KataGo AI is running in another tab or window — turn it off there (or close it) to use it here.</span>
    : running ? <Spinner label="Analyzing…" />
      : analysisErr ? <span className="gr-analyze-err">{analysisErr}</span>
        : (currentAnalysis && playedNext && currentAnalysis.playedEval) ? (() => {
            // pointsLost can be slightly negative (played move beat the search's
            // best at low visits) — sign it, don't prefix "−".
            const loss = currentAnalysis.playedEval.pointsLost;
            return (
              <>played {coordLabel(playedNext.x, playedNext.y)}{' '}
                <span className={loss > 0.05 ? 'gr-loss' : undefined}>
                  ({loss < 0 ? '+' : '−'}{Math.abs(loss).toFixed(1)})
                </span>
              </>
            );
          })()
          : null;

  return (
    <div className={`gr${outcome ? ` gr--${outcome}` : ''}`}>
      <div className="gr-head">
        <Link to={backTo} className="gr-back">← Games</Link>
        <h1 className="gr-title">
          {info.playerBlack} <span className="gr-rank">[{info.rankBlack}]</span>
          <span className="gr-vs"> vs. </span>
          {info.playerWhite} <span className="gr-rank">[{info.rankWhite}]</span>
        </h1>
        <span className="gr-meta">
          <span>{when}</span>
          <span className="gr-dot">·</span>
          <span>{mainlineTotal} moves</span>
          {game.finalScore != null ? (
            <><span className="gr-dot">·</span><strong>{scoreLabel(game.finalScore)}</strong></>
          ) : info.result ? (
            <><span className="gr-dot">·</span>
              <strong className={outcome ? `gr-result gr-result--${outcome}` : undefined}>{info.result}</strong></>
          ) : null}
          {outcome && (
            <span className={`gr-outcome gr-outcome--${outcome}`}>{outcome === 'win' ? 'You won' : 'You lost'}</span>
          )}
        </span>
        <div className="gr-head-spacer" />
        <button
          type="button"
          className={analyzeOn ? 'gr-analyze-btn active' : 'gr-analyze-btn'}
          onClick={() => setAnalyzeOn((o) => !o)}
        >
          {analyzeOn ? 'AI review: on' : 'AI review'}
        </button>
        {analyzeOn && (
          <button
            type="button"
            className={ponder ? 'gr-gear active' : 'gr-gear'}
            onClick={() => setPonder((p) => !p)}
            title={ponder ? 'Pause — stop deepening this position' : 'Keep analyzing — deepen this position for more accuracy'}
            aria-pressed={ponder}
          >
            {ponder ? '⏸' : '▶'}
          </button>
        )}
        {analyzeOn && analysis && analysis.cursor === cursor && (
          <span className="gr-visits" title="Playouts behind the current analysis">
            {analysis.data.rootVisits.toLocaleString()}
          </span>
        )}
      </div>

      <div className={`gr-body${stacked ? ' gr-body--stacked' : ''}`} ref={bodyRef}>
        <div className="gr-board-square" style={{ width: boardSize, height: boardSize }}>
          <Board
            stones={shown.stones}
            annotations={annotations}
            aiCandidates={aiCandidates}
            spinnerAt={showTop ? { x: showTop.x, y: showTop.y } : null}
            ghostStone={playedNext ? { x: playedNext.x, y: playedNext.y, color: playedNext.color } : null}
            onPlay={(x, y) => playAt(x, y)}
          />
        </div>

        <div className="gr-panel">
          {analyzeOn ? (
            <div className="gr-graph-card">
              <div className="gr-graph-head">
                {trajRunning ? (
                  <span className="gr-rerun gr-rerun-busy"><Spinner label="Analyzing…" /></span>
                ) : (
                  <button
                    type="button"
                    className={`gr-rerun${trajStale ? ' stale' : ''}`}
                    onClick={rerun}
                    aria-label="Recompute the score graph from scratch"
                    title={trajStale ? 'Settings changed — recompute the score graph' : 'Recompute the score graph from scratch'}
                  >
                    ↻
                  </button>
                )}
                <span className="gr-graph-kata">
                  {currentAnalysis && (
                    <span>KataGo <strong>{scoreLabel(currentAnalysis.rootScoreLead)}</strong> · {currentAnalysis.rootVisits}v</span>
                  )}
                </span>
              </div>
              {points.length > 1 ? (
                <ReviewGraph points={points} total={total} cursor={cursor} onSeek={seek} />
              ) : (
                <div className="gr-graph-empty">
                  {running ? <Spinner label="Analyzing…" /> : 'The score timeline appears as KataGo analyzes the game.'}
                </div>
              )}
              {analysisLine && <div className="gr-analysis">{analysisLine}</div>}
            </div>
          ) : (
            <div className="gr-scrub-bar">
              <input type="range" min={0} max={total} value={cursor} onChange={(e) => seek(Number(e.target.value))} aria-label="Move" />
            </div>
          )}

          <div className="gr-controls">
            <button type="button" onClick={() => seek(0)} disabled={cursor === 0} aria-label="Start">⏮</button>
            <button type="button" onClick={() => seek(cursor - 1)} disabled={cursor === 0} aria-label="Previous">◀</button>
            <button type="button" onClick={() => seek(cursor + 1)} disabled={cursor === total} aria-label="Next">▶</button>
            <button type="button" onClick={() => seek(total)} disabled={cursor === total} aria-label="End">⏭</button>
            <div className="gr-controls-spacer" />
            <div className="gr-readout">
              <div className="gr-readout-move">
                move {cursor} / {total}{!onMainline && <> · <span className="gr-status-var">variation</span></>}
              </div>
              {cursorScore !== null && <div className="gr-readout-est">estimate <strong>{scoreLabel(cursorScore)}</strong></div>}
            </div>
          </div>

          <div className="gr-moves-panel" ref={listRef}>
            <table className="gr-moves">
              <thead>
                <tr>
                  <th>Game</th>
                  <th>{onMainline ? 'Variations' : `Variation · from move ${branchPoint > 0 ? branchPoint : 'start'}`}</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: maxRows }, (_, k) => k + 1).map((i) => {
                  const gameNode = i <= mainLen ? mainNodeIds[i] : null;
                  const varNode = !onMainline && i > branchPoint && i < lineNodeIds.length ? lineNodeIds[i] : null;
                  const previews = previewsAt(i);
                  const rowActive = cursor === i;
                  return (
                    <tr key={i} ref={rowActive ? activeRef : null}>
                      <td className="gr-cell">
                        {gameNode != null && moveCell(gameNode, i, rowActive && activeIsMain, true, () => goGame(i))}
                      </td>
                      <td className="gr-cell gr-cell-var">
                        {varNode != null && moveCell(varNode, i, rowActive && !activeIsMain, gameNode == null, () => goVar(i))}
                        {previews.length > 0 && (
                          <span className="gr-previews">{previews.map((c) => previewChip(c))}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {lines.length > 0 && (
                <tfoot>
                  <tr>
                    <td colSpan={2} className="gr-moves-foot">
                      <button type="button" onClick={clearLines}>Clear all variations</button>
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
