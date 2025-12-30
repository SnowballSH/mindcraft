export class FirstDeathTimeMetric {
  constructor() {
    this.id = 'first_death_time';
    this.label = 'First death time (ms since episode start)';
    this.enabledByDefault = true;
  }

  init() {
    return {
      episodeStartTsByAgent: {},
      firstDeathTsByAgent: {},
    };
  }

  reduce(state, event) {
    if (!event) return state;
    const type = event.type;
    if (type === 'episode_started') {
      const a = event.agent_name;
      if (a && state.episodeStartTsByAgent[a] === undefined) {
        state.episodeStartTsByAgent[a] = event.ts;
      }
    }
    if (type === 'death') {
      const a = event.agent_name;
      if (a && state.firstDeathTsByAgent[a] === undefined) {
        state.firstDeathTsByAgent[a] = event.ts;
      }
    }
    return state;
  }

  snapshot(state) {
    const perAgent = {};
    for (const [agent, deathTs] of Object.entries(state.firstDeathTsByAgent)) {
      const start = state.episodeStartTsByAgent[agent];
      perAgent[agent] = start ? deathTs - start : null;
    }
    return { perAgent };
  }
}


