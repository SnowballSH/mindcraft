import { makeEvent } from '../schema.js';

function normalizeTargets(task) {
  if (!task) return null;
  const target = task.target;
  const num = task.number_of_target;
  if (!target) return null;
  if (typeof target === 'string') {
    return { [target.toLowerCase()]: typeof num === 'number' ? num : 1 };
  }
  if (Array.isArray(target)) {
    const out = {};
    for (const t of target) out[String(t).toLowerCase()] = 1;
    return out;
  }
  if (typeof target === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(target)) out[String(k).toLowerCase()] = Number(v);
    return out;
  }
  return null;
}

export class TaskProgressCollector {
  constructor() {
    this.id = 'task_progress';
    this.label = 'Task progress (from inventory vs settings.task)';
    this.enabledByDefault = true;
    this._lastProgressKey = new Map(); // agent -> string
  }

  getMeta() {
    return { id: this.id, label: this.label, enabledByDefault: this.enabledByDefault };
  }

  onStateUpdate({ states, getAgentTask, append }) {
    if (!states || typeof states !== 'object') return;
    for (const [agentName, state] of Object.entries(states)) {
      if (!state || state.error) continue;
      const task = getAgentTask(agentName);
      const targets = normalizeTargets(task);
      if (!targets) continue;
      const counts = state?.inventory?.counts || {};

      const perItem = {};
      let allMet = true;
      for (const [item, required] of Object.entries(targets)) {
        const have = Number(counts[item] || 0);
        perItem[item] = { have, required };
        if (have < required) allMet = false;
      }

      const taskId = task?.task_id || null;
      const key = JSON.stringify({ taskId, perItem, allMet });
      if (this._lastProgressKey.get(agentName) === key) continue;
      this._lastProgressKey.set(agentName, key);
      append(
        makeEvent('task_progress', {
          agent_name: agentName,
          task_id: taskId,
          progress: perItem,
          success: allMet,
        })
      );
    }
  }
}


