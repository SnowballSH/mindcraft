import { makeEvent } from '../schema.js';

function diffCounts(prev = {}, next = {}) {
  const changed = {};
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const k of keys) {
    const a = Number(prev[k] || 0);
    const b = Number(next[k] || 0);
    if (a !== b) changed[k] = b - a;
  }
  return changed;
}

export class InventoryDeltaCollector {
  constructor() {
    this.id = 'inventory_delta';
    this.label = 'Inventory deltas';
    this.enabledByDefault = true;
    this._lastCounts = new Map(); // agent -> counts object
  }

  getMeta() {
    return { id: this.id, label: this.label, enabledByDefault: this.enabledByDefault };
  }

  onStateUpdate({ states, append }) {
    if (!states || typeof states !== 'object') return;
    for (const [agentName, state] of Object.entries(states)) {
      if (!state || state.error) continue;
      const counts = state?.inventory?.counts;
      if (!counts || typeof counts !== 'object') continue;
      const prev = this._lastCounts.get(agentName);
      this._lastCounts.set(agentName, counts);
      if (!prev) continue;
      const delta = diffCounts(prev, counts);
      if (Object.keys(delta).length === 0) continue;
      append(
        makeEvent('inventory_delta', {
          agent_name: agentName,
          delta,
          counts,
        })
      );
    }
  }
}


