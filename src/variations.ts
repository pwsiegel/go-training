// Session-scoped variation tree for game review. The mainline (from the SGF) is
// the initial spine; clicking a move on the board branches a variation off the
// current position. Everything here is pure — the tree lives in React state and
// is never written to Firestore. The visualization consumes `variationLines`;
// navigation consumes `movesTo` / `nodeAtDepth`.

import type { GameMove, SavedNode } from './data/model';

export type TreeNode = {
  id: number;
  parent: number | null;   // null for the root (empty board)
  move: GameMove | null;   // null for the root
  children: number[];      // children[0] is the "main" continuation of this node
  mainline: boolean;       // part of the original SGF spine
};

export type GameTree = {
  nodes: Record<number, TreeNode>;
  rootId: number;
  mainlineLeafId: number;
  nextId: number;
};

/** A branch that leaves the mainline — one entry per variation leaf. */
export type VariationLine = {
  leafId: number;
  branchAfter: number;   // move number the variation diverges after (0 = from the empty board)
  firstMove: GameMove;   // the first off-mainline move
  length: number;        // total moves along the line
};

export function buildTree(mainline: GameMove[]): GameTree {
  const nodes: Record<number, TreeNode> = {
    0: { id: 0, parent: null, move: null, children: [], mainline: true },
  };
  let prev = 0;
  let id = 1;
  for (const move of mainline) {
    nodes[id] = { id, parent: prev, move, children: [], mainline: true };
    nodes[prev].children.push(id);
    prev = id;
    id++;
  }
  return { nodes, rootId: 0, mainlineLeafId: prev, nextId: id };
}

/** Root→node ids, inclusive. */
export function pathIds(tree: GameTree, nodeId: number): number[] {
  const out: number[] = [];
  for (let cur: number | null = nodeId; cur !== null; cur = tree.nodes[cur].parent) out.push(cur);
  return out.reverse();
}

/** The moves from the root to `nodeId` (excludes the empty root). */
export function movesTo(tree: GameTree, nodeId: number): GameMove[] {
  return pathIds(tree, nodeId)
    .map((id) => tree.nodes[id].move)
    .filter((m): m is GameMove => m !== null);
}

/** Depth of a node (root = 0), i.e. the number of moves played to reach it. */
export function depthOf(tree: GameTree, nodeId: number): number {
  return pathIds(tree, nodeId).length - 1;
}

/** The node `depth` moves along the path to `leafId` (clamped). */
export function nodeAtDepth(tree: GameTree, leafId: number, depth: number): number {
  const ids = pathIds(tree, leafId);
  return ids[Math.max(0, Math.min(depth, ids.length - 1))];
}

/** Descend a node's main continuation to a leaf — defines a line's tail. */
export function leafOf(tree: GameTree, nodeId: number): number {
  let cur = nodeId;
  while (tree.nodes[cur].children.length > 0) cur = tree.nodes[cur].children[0];
  return cur;
}

function childByMove(tree: GameTree, nodeId: number, x: number, y: number): number | null {
  for (const c of tree.nodes[nodeId].children) {
    const m = tree.nodes[c].move;
    if (m && m.x === x && m.y === y) return c;
  }
  return null;
}

/** Play (or reuse) `move` under `nodeId`. Returns the possibly-grown tree and the
 * child id, so the caller can advance onto it. Reusing an existing child keeps
 * re-walking a variation idempotent. */
export function addMove(
  tree: GameTree, nodeId: number, move: GameMove,
): { tree: GameTree; childId: number } {
  const existing = childByMove(tree, nodeId, move.x, move.y);
  if (existing !== null) return { tree, childId: existing };
  const childId = tree.nextId;
  return {
    tree: {
      ...tree,
      nextId: childId + 1,
      nodes: {
        ...tree.nodes,
        [childId]: { id: childId, parent: nodeId, move, children: [], mainline: false },
        [nodeId]: { ...tree.nodes[nodeId], children: [...tree.nodes[nodeId].children, childId] },
      },
    },
    childId,
  };
}

/** Drop a variation leaf and any now-childless ancestors, back to the mainline. */
export function pruneLine(tree: GameTree, leafId: number): GameTree {
  const nodes = { ...tree.nodes };
  let cur: number | null = leafId;
  while (cur !== null && !nodes[cur].mainline && nodes[cur].children.length === 0) {
    const removed: number = cur;
    const parentId: number | null = nodes[removed].parent;
    delete nodes[removed];
    if (parentId !== null) {
      nodes[parentId] = { ...nodes[parentId], children: nodes[parentId].children.filter((c) => c !== removed) };
    }
    cur = parentId;
  }
  return { ...tree, nodes };
}

/** Remove a node and its entire subtree (and unlink it from its parent). Used to
 * delete a whole variation branch. Refuses to touch mainline nodes. */
export function pruneSubtree(tree: GameTree, nodeId: number): GameTree {
  if (!tree.nodes[nodeId] || tree.nodes[nodeId].mainline) return tree;
  const parent = tree.nodes[nodeId].parent;
  const nodes = { ...tree.nodes };
  const stack = [nodeId];
  while (stack.length) {
    const id = stack.pop() as number;
    const n = nodes[id];
    if (!n) continue;
    for (const c of n.children) stack.push(c);
    delete nodes[id];
  }
  if (parent != null && nodes[parent]) {
    nodes[parent] = { ...nodes[parent], children: nodes[parent].children.filter((c) => c !== nodeId) };
  }
  return { ...tree, nodes };
}

/** Every off-mainline branch, oldest divergence first — for the "lines" strip. */
export function variationLines(tree: GameTree): VariationLine[] {
  const lines: VariationLine[] = [];
  for (const node of Object.values(tree.nodes)) {
    if (node.mainline || node.children.length > 0) continue;   // variation leaves only
    const ids = pathIds(tree, node.id);
    const firstOff = ids.find((id) => !tree.nodes[id].mainline);
    const firstNode = firstOff != null ? tree.nodes[firstOff] : null;
    if (!firstNode?.move) continue;
    lines.push({
      leafId: node.id,
      branchAfter: depthOf(tree, firstNode.id) - 1,
      firstMove: firstNode.move,
      length: depthOf(tree, node.id),
    });
  }
  return lines.sort((a, b) => a.branchAfter - b.branchAfter || a.leafId - b.leafId);
}

/** Whether `nodeId` sits off the mainline (used to tint variation moves). */
export function isVariationNode(tree: GameTree, nodeId: number): boolean {
  return !tree.nodes[nodeId].mainline;
}

// ---------- persistence (see ReviewDoc) ----------

/** The off-mainline nodes, ascending by id — the only part worth persisting
 * (the mainline is rebuilt from the game SGF). */
export function serializeVariations(tree: GameTree): SavedNode[] {
  return Object.values(tree.nodes)
    .filter((n) => !n.mainline && n.move != null && n.parent != null)
    .map((n) => ({ id: n.id, parent: n.parent as number, move: n.move as GameMove }))
    .sort((a, b) => a.id - b.id);
}

/** Rebuild a tree from the mainline plus saved variation nodes. Nodes are
 * spliced in ascending-id order (so a parent always exists first); any whose
 * parent is missing — e.g. an unexpectedly changed mainline — are dropped. */
export function deserializeVariations(mainline: GameMove[], saved: SavedNode[]): GameTree {
  const base = buildTree(mainline);
  const nodes = { ...base.nodes };
  let maxId = base.mainlineLeafId;
  for (const s of [...saved].sort((a, b) => a.id - b.id)) {
    if (nodes[s.id] || !nodes[s.parent]) continue;
    nodes[s.id] = { id: s.id, parent: s.parent, move: s.move, children: [], mainline: false };
    nodes[s.parent] = { ...nodes[s.parent], children: [...nodes[s.parent].children, s.id] };
    if (s.id > maxId) maxId = s.id;
  }
  return { ...base, nodes, nextId: maxId + 1 };
}
