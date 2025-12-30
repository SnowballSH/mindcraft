import { makeEvent } from '../schema.js';

export class EpisodeCollector {
  constructor() {
    this.id = 'episode';
    this.label = 'Episode lifecycle';
    this.enabledByDefault = true;

    this._seenInEpisode = new Map(); // agent -> episode_id
  }

  getMeta() {
    return { id: this.id, label: this.label, enabledByDefault: this.enabledByDefault };
  }

  onStateUpdate({ runId, states, append }) {
    if (!states || typeof states !== 'object') return;
    for (const [agentName, state] of Object.entries(states)) {
      if (!state || state.error) continue;
      if (!this._seenInEpisode.has(agentName)) {
        const episodeId = `${runId}:${agentName}:${Date.now()}`;
        this._seenInEpisode.set(agentName, episodeId);
        append(makeEvent('episode_started', { agent_name: agentName, episode_id: episodeId }));
      }
    }
  }

  onRunStop({ append }) {
    for (const [agentName, episodeId] of this._seenInEpisode.entries()) {
      append(makeEvent('episode_ended', { agent_name: agentName, episode_id: episodeId, reason: 'run_stop' }));
    }
    this._seenInEpisode.clear();
  }
}


