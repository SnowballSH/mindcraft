export class TimeToGoalMetric {
  constructor() {
    this.id = 'time_to_goal';
    this.label = 'Time to goal (ms since episode start)';
    this.enabledByDefault = true;
  }

  init() {
    return {
      episodeStartTsByAgent: {},
      goalTsByAgent: {},
      taskIdByAgent: {},
    };
  }

  reduce(state, event) {
    if (!event) return state;
    if (event.type === 'episode_started') {
      const a = event.agent_name;
      if (a && state.episodeStartTsByAgent[a] === undefined) {
        state.episodeStartTsByAgent[a] = event.ts;
      }
    }
    if (event.type === 'task_progress') {
      const a = event.agent_name;
      if (!a) return state;
      if (event.task_id) state.taskIdByAgent[a] = event.task_id;
      if (event.success === true && state.goalTsByAgent[a] === undefined) {
        state.goalTsByAgent[a] = event.ts;
      }
    }
    return state;
  }

  snapshot(state) {
    const perAgent = {};
    for (const [agent, goalTs] of Object.entries(state.goalTsByAgent)) {
      const start = state.episodeStartTsByAgent[agent];
      perAgent[agent] = start ? goalTs - start : null;
    }
    return { perAgent, taskIdByAgent: state.taskIdByAgent };
  }
}


