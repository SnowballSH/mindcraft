export class MetricsEngine {
  constructor(metrics) {
    this.metrics = metrics;
    this.enabled = new Map(metrics.map((m) => [m.id, m.enabledByDefault ?? true]));
    this.state = new Map(metrics.map((m) => [m.id, m.init()]));
  }

  setEnabled(metricId, on) {
    if (!this.enabled.has(metricId)) throw new Error(`Unknown metric ${metricId}`);
    this.enabled.set(metricId, !!on);
  }

  isEnabled(metricId) {
    return !!this.enabled.get(metricId);
  }

  getConfig() {
    return this.metrics.map((m) => ({
      id: m.id,
      label: m.label,
      enabled: this.isEnabled(m.id),
      enabledByDefault: m.enabledByDefault ?? true,
    }));
  }

  resetAll() {
    for (const m of this.metrics) this.state.set(m.id, m.init());
  }

  applyEvent(event) {
    for (const m of this.metrics) {
      if (!this.isEnabled(m.id)) continue;
      const prev = this.state.get(m.id);
      const next = m.reduce(prev, event);
      this.state.set(m.id, next);
    }
  }

  snapshot() {
    const out = {};
    for (const m of this.metrics) {
      out[m.id] = m.snapshot(this.state.get(m.id));
    }
    return out;
  }
}


