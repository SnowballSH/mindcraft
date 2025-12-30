import fs from 'fs';
import path from 'path';

import { makeEvent } from './schema.js';

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function safeJsonLine(obj) {
  return JSON.stringify(obj) + '\n';
}

export class TelemetryService {
  constructor({ runsDir }) {
    this.runsDir = runsDir;
    this.currentRun = null;
    this._stream = null;
    this._events = [];
    this._onEventCbs = new Set();
  }

  isRecording() {
    return !!this.currentRun;
  }

  getRunInfo() {
    return this.currentRun;
  }

  onEvent(cb) {
    this._onEventCbs.add(cb);
    return () => this._onEventCbs.delete(cb);
  }

  listInMemoryEvents() {
    return this._events.slice();
  }

  startRun({ runId, meta }) {
    if (this.currentRun) throw new Error('Run already active');
    ensureDir(this.runsDir);

    const startedAt = Date.now();
    const runDir = path.join(this.runsDir, runId);
    ensureDir(runDir);

    const eventsPath = path.join(runDir, 'events.jsonl');
    const metaPath = path.join(runDir, 'meta.json');

    fs.writeFileSync(metaPath, JSON.stringify({ runId, startedAt, ...meta }, null, 2) + '\n', 'utf8');
    this._stream = fs.createWriteStream(eventsPath, { flags: 'a' });
    this.currentRun = { runId, startedAt, runDir, eventsPath, metaPath };
    this._events = [];

    this.append(makeEvent('run_started', { run_id: runId, meta }));
    return this.currentRun;
  }

  stopRun({ reason = 'user_stop' } = {}) {
    if (!this.currentRun) return;
    this.append(makeEvent('run_ended', { run_id: this.currentRun.runId, reason }));
    try {
      this._stream?.end();
    } finally {
      this._stream = null;
      this.currentRun = null;
      this._events = [];
    }
  }

  append(event) {
    if (!this.currentRun) return;
    const enriched = {
      ...event,
      run_id: event.run_id ?? this.currentRun.runId,
    };
    this._events.push(enriched);
    this._stream.write(safeJsonLine(enriched));
    for (const cb of this._onEventCbs) cb(enriched);
  }
}


