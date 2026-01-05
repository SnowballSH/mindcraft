import type { BTState } from './types.js';
import type { IRTree } from './types.js';

export function createInitialState(tree: IRTree, vars: Record<string, string>): BTState {
  return {
    bt: tree,
    runtime: { statusById: {}, stack: [] },
    world: { inventory: {} },
    vars,
    logs: [],
  };
}
