// Builds KataGo v7 NN inputs (22 spatial + 19 global planes) for one position,
// including liberties, ko, area (Chinese), ladders, and the last-5-move history.
// Extracted from the worker so the same feature path serves analysis, value eval,
// and human-net policy — and can be validated in isolation.

import type { BoardState, GameRules, Move, Player } from '../../types';
import {
  BLACK,
  BOARD_AREA,
  BOARD_SIZE,
  PASS_MOVE,
  WHITE,
  computeAreaMapV7KataGoInto,
  computeLadderFeaturesV7KataGoInto,
  computeLadderedStonesV7KataGoInto,
  computeLibertyMapInto,
  playMove,
  type SimPosition,
  type StoneColor,
} from './fastBoard';
import { fillInputsV7Fast, type RecentMove } from './featuresV7Fast';

// Reusable scratch, lazily (re)sized to the current board area.
let scratchArea = -1;
let stonesScratch: Uint8Array;
let prevStonesScratch: Uint8Array;
let prevPrevStonesScratch: Uint8Array;
let koSimStonesScratch: Uint8Array;
let koSimPosScratch: SimPosition;
const koCaptureStackScratch: number[] = [];
let libertyMapScratch: Uint8Array;
let areaMapScratch: Uint8Array;
let ladderedStonesScratch: Uint8Array;
let ladderWorkingMovesScratch: Uint8Array;
let prevLadderedStonesScratch: Uint8Array;
let prevPrevLadderedStonesScratch: Uint8Array;

function ensureScratch(): void {
  if (scratchArea === BOARD_AREA) return;
  scratchArea = BOARD_AREA;
  stonesScratch = new Uint8Array(BOARD_AREA);
  prevStonesScratch = new Uint8Array(BOARD_AREA);
  prevPrevStonesScratch = new Uint8Array(BOARD_AREA);
  koSimStonesScratch = new Uint8Array(BOARD_AREA);
  koSimPosScratch = { stones: koSimStonesScratch, koPoint: -1 };
  libertyMapScratch = new Uint8Array(BOARD_AREA);
  areaMapScratch = new Uint8Array(BOARD_AREA);
  ladderedStonesScratch = new Uint8Array(BOARD_AREA);
  ladderWorkingMovesScratch = new Uint8Array(BOARD_AREA);
  prevLadderedStonesScratch = new Uint8Array(BOARD_AREA);
  prevPrevLadderedStonesScratch = new Uint8Array(BOARD_AREA);
}

const playerToColor = (p: Player): StoneColor => (p === 'black' ? BLACK : WHITE);

function boardStateToStonesInto(board: BoardState, out: Uint8Array): void {
  out.fill(0);
  for (let y = 0; y < BOARD_SIZE; y++) {
    const row = board[y];
    for (let x = 0; x < BOARD_SIZE; x++) {
      const v = row?.[x] ?? null;
      if (!v) continue;
      out[y * BOARD_SIZE + x] = v === 'black' ? BLACK : WHITE;
    }
  }
}

function movesToRecentMoves(moves: Move[]): RecentMove[] {
  const out = new Array<RecentMove>(moves.length);
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i]!;
    out[i] = { move: m.x < 0 || m.y < 0 ? PASS_MOVE : m.y * BOARD_SIZE + m.x, player: m.player };
  }
  return out;
}

function countHistoryTurnsIncluded(args: {
  recentMoves: RecentMove[];
  currentPlayer: Player;
  conservativePassAndIsRoot: boolean;
}): number {
  const lastMove = args.recentMoves.length > 0 ? args.recentMoves[args.recentMoves.length - 1] : null;
  const passWouldEndGame = lastMove?.move === PASS_MOVE;
  if (args.conservativePassAndIsRoot && passWouldEndGame) return 0;

  const pla = args.currentPlayer;
  const opp = pla === 'black' ? 'white' : 'black';
  const expectedPlayers: Player[] = [opp, pla, opp, pla, opp];

  let included = 0;
  for (let i = 0; i < 5; i++) {
    const m = args.recentMoves[args.recentMoves.length - 1 - i];
    if (!m) break;
    if (m.player !== expectedPlayers[i]) break;
    included++;
  }
  return included;
}

function computeKoPointAfterMove(previousStones: Uint8Array, move: Move | null): number {
  if (!move || move.x < 0 || move.y < 0) return -1;
  koSimStonesScratch.set(previousStones);
  koSimPosScratch.koPoint = -1;
  koCaptureStackScratch.length = 0;
  try {
    playMove(koSimPosScratch, move.y * BOARD_SIZE + move.x, playerToColor(move.player), koCaptureStackScratch);
    return koSimPosScratch.koPoint;
  } catch {
    return -1;
  }
}

export function fillPositionInputsV7(args: {
  board: BoardState;
  previousBoard?: BoardState;
  previousPreviousBoard?: BoardState;
  currentPlayer: Player;
  moveHistory: Move[];
  komi: number;
  rules: GameRules;
  conservativePassAndIsRoot: boolean;
  // Cap recent-move planes (0 = none). KataGo's analysis engine / human-net
  // eval uses 0 (ignorePreRootHistory); full-history analysis leaves it default.
  maxHistory?: number;
  outSpatial: Float32Array;
  outGlobal: Float32Array;
}): void {
  ensureScratch();
  const maxHistory = args.maxHistory ?? 5;
  boardStateToStonesInto(args.board, stonesScratch);

  if (args.previousBoard) boardStateToStonesInto(args.previousBoard, prevStonesScratch);
  else prevStonesScratch.set(stonesScratch);

  if (args.previousPreviousBoard) boardStateToStonesInto(args.previousPreviousBoard, prevPrevStonesScratch);
  else prevPrevStonesScratch.set(prevStonesScratch);

  const lastMove = args.moveHistory.length > 0 ? args.moveHistory[args.moveHistory.length - 1]! : null;
  const prevMove = args.moveHistory.length >= 2 ? args.moveHistory[args.moveHistory.length - 2]! : null;

  const koPoint = args.previousBoard ? computeKoPointAfterMove(prevStonesScratch, lastMove) : -1;
  const prevKoPoint = args.previousPreviousBoard ? computeKoPointAfterMove(prevPrevStonesScratch, prevMove) : -1;
  const prevPrevKoPoint = -1;

  const recentMoves = movesToRecentMoves(args.moveHistory);
  const numTurnsOfHistoryIncluded = Math.min(
    maxHistory,
    countHistoryTurnsIncluded({
      recentMoves,
      currentPlayer: args.currentPlayer,
      conservativePassAndIsRoot: args.conservativePassAndIsRoot,
    }),
  );

  const prevLadderStones = numTurnsOfHistoryIncluded < 1 ? stonesScratch : prevStonesScratch;
  const prevLadderKoPoint = numTurnsOfHistoryIncluded < 1 ? koPoint : prevKoPoint;
  const prevPrevLadderStones = numTurnsOfHistoryIncluded < 2 ? prevLadderStones : prevPrevStonesScratch;
  const prevPrevLadderKoPoint = numTurnsOfHistoryIncluded < 2 ? prevLadderKoPoint : prevPrevKoPoint;

  computeLibertyMapInto(stonesScratch, libertyMapScratch);
  if (args.rules === 'chinese') computeAreaMapV7KataGoInto(stonesScratch, areaMapScratch);

  computeLadderFeaturesV7KataGoInto({
    stones: stonesScratch,
    koPoint,
    currentPlayer: playerToColor(args.currentPlayer),
    outLadderedStones: ladderedStonesScratch,
    outLadderWorkingMoves: ladderWorkingMovesScratch,
  });
  computeLadderedStonesV7KataGoInto({ stones: prevLadderStones, koPoint: prevLadderKoPoint, outLadderedStones: prevLadderedStonesScratch });
  computeLadderedStonesV7KataGoInto({ stones: prevPrevLadderStones, koPoint: prevPrevLadderKoPoint, outLadderedStones: prevPrevLadderedStonesScratch });

  fillInputsV7Fast({
    stones: stonesScratch,
    koPoint,
    currentPlayer: args.currentPlayer,
    recentMoves,
    komi: args.komi,
    rules: args.rules,
    conservativePassAndIsRoot: args.conservativePassAndIsRoot,
    maxHistory,
    libertyMap: libertyMapScratch,
    areaMap: args.rules === 'chinese' ? areaMapScratch : undefined,
    ladderedStones: ladderedStonesScratch,
    prevLadderedStones: prevLadderedStonesScratch,
    prevPrevLadderedStones: prevPrevLadderedStonesScratch,
    ladderWorkingMoves: ladderWorkingMovesScratch,
    outSpatial: args.outSpatial,
    outGlobal: args.outGlobal,
  });
}
