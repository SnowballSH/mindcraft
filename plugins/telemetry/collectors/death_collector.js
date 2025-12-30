import { makeEvent } from '../schema.js';

export class DeathCollector {
  constructor() {
    this.id = 'death';
    this.label = 'Death events';
    this.enabledByDefault = true;
    this._lastHealth = new Map(); // agent -> number
    this._deathCount = new Map(); // agent -> number
  }

  getMeta() {
    return { id: this.id, label: this.label, enabledByDefault: this.enabledByDefault };
  }

  onStateUpdate({ states, append }) {
    if (!states || typeof states !== 'object') return;
    for (const [agentName, state] of Object.entries(states)) {
      if (!state || state.error) continue;
      const health = Number(state?.gameplay?.health);
      if (!Number.isFinite(health)) continue;
      const prev = this._lastHealth.get(agentName);
      this._lastHealth.set(agentName, health);
      if (prev === undefined) continue;
      const isDeathTransition = prev > 0 && health <= 0;
      if (!isDeathTransition) continue;
      const deathIndex = (this._deathCount.get(agentName) || 0) + 1;
      this._deathCount.set(agentName, deathIndex);
      append(
        makeEvent('death', {
          agent_name: agentName,
          death_index: deathIndex,
          health,
          position: state?.gameplay?.position,
          dimension: state?.gameplay?.dimension,
          timeOfDay: state?.gameplay?.timeOfDay,
        })
      );
    }
  }
}


