// AI-generated whole-board tsumego (experimental). Mined from pro-game
// positions + weak human-net continuations by evaluation/puzzle-gen in the
// tools repo, published as a library collection JSON that is NOT listed in
// library/index.json — it's served to the dedicated AI-tsumego surface only.
import { listProblems } from './library';
import type { LibProblem } from './model';

export const AI_COLLECTION_SLUG = 'ai-whole-board';

export type AiTarget = {
  color: 'B' | 'W';
  chain: [number, number][];      // [x, y] points of the marked group
  verdict: 'alive' | 'dead';      // converged truth with the puzzle's mover to play
  own_cheap: number;              // Black-perspective ownership at few visits
  own_converged: number;          //   … at many visits (the answer key)
  own_after_tenuki: number;       //   … if the mover passes (proves it's at stake)
};

export type AiGen = {
  source_game: string;
  pro_turn: number;
  sim_rank: string;
  sim_plies: number;
  mined_at_ply: number;
  target: AiTarget;
  difficulty: string;             // weakest solving rank ("rank_3d") or "9d+"
  ladder: Record<string, boolean>;
  good_moves: string[];           // GTP moves within tolerance of best
  best_move: string;
  score_black: number;            // converged Black score lead at the start
};

export type AiProblem = LibProblem & { gen: AiGen };

export function listAiProblems(): Promise<AiProblem[]> {
  return listProblems(AI_COLLECTION_SLUG) as Promise<AiProblem[]>;
}

/** "rank_3d" -> "3d", "9d+" stays. */
export function difficultyLabel(d: string): string {
  return d.replace(/^rank_/, '');
}
