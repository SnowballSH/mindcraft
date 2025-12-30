function normalizeTargets(taskProgressEvent) {
  // task_progress.progress is already normalized to { item: {have, required} }
  const progress = taskProgressEvent?.progress;
  if (!progress || typeof progress !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(progress)) {
    out[String(k).toLowerCase()] = { have: Number(v?.have || 0), required: Number(v?.required || 0) };
  }
  return out;
}

function includesWoodTarget(targets) {
  if (!targets) return false;
  // broad: count as "wood collection" if any target ends with _log or contains 'log'
  return Object.keys(targets).some((k) => k.includes('log'));
}

export class WoodCollectionSuccessMetric {
  constructor() {
    this.id = 'wood_collection_success_rate';
    this.label = 'Wood collection success rate (by task_id)';
    this.enabledByDefault = true;
  }

  init() {
    return {
      seenEpisode: {}, // agent -> true
      taskIdByAgent: {},
      woodTaskSeenByAgent: {}, // agent -> boolean
      successByAgent: {}, // agent -> boolean
      countsByTaskId: {}, // task_id -> { attempts, successes }
    };
  }

  reduce(state, event) {
    if (!event) return state;
    if (event.type === 'episode_started') {
      const a = event.agent_name;
      if (a) state.seenEpisode[a] = true;
      return state;
    }
    if (event.type !== 'task_progress') return state;

    const a = event.agent_name;
    if (!a) return state;
    const taskId = event.task_id || 'unknown_task';
    state.taskIdByAgent[a] = taskId;

    const targets = normalizeTargets(event);
    const isWoodTask = includesWoodTarget(targets);
    if (!isWoodTask) return state;

    // mark attempt on first time we see a wood task for this agent (in this run)
    if (!state.woodTaskSeenByAgent[a]) {
      state.woodTaskSeenByAgent[a] = true;
      if (!state.countsByTaskId[taskId]) state.countsByTaskId[taskId] = { attempts: 0, successes: 0 };
      state.countsByTaskId[taskId].attempts += 1;
    }

    if (event.success === true && state.successByAgent[a] !== true) {
      state.successByAgent[a] = true;
      if (!state.countsByTaskId[taskId]) state.countsByTaskId[taskId] = { attempts: 0, successes: 0 };
      state.countsByTaskId[taskId].successes += 1;
    }

    return state;
  }

  snapshot(state) {
    const ratesByTaskId = {};
    for (const [taskId, c] of Object.entries(state.countsByTaskId)) {
      ratesByTaskId[taskId] = {
        attempts: c.attempts,
        successes: c.successes,
        successRate: c.attempts > 0 ? c.successes / c.attempts : null,
      };
    }
    return { ratesByTaskId };
  }
}


