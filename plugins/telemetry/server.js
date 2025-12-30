import express from 'express';
import http from 'http';
import path from 'path';
import { Server } from 'socket.io';
import fs from 'fs';
import readline from 'readline';

import { fileURLToPath } from 'url';

import { MindServerClient } from './mindserver_client.js';
import { TelemetryService } from './telemetry_service.js';
import { makeEvent } from './schema.js';
import { getCollectorRegistry } from './collectors/collector_registry.js';
import { getMetricRegistry } from './metrics/metrics_registry.js';
import { MetricsEngine } from './metrics/metrics_engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MINDSERVER_HOST = process.env.MINDSERVER_HOST || 'localhost';
const MINDSERVER_PORT = Number(process.env.MINDSERVER_PORT || 8080);
const TELEMETRY_PORT = Number(process.env.TELEMETRY_PORT || 8090);
const RUNS_DIR = process.env.TELEMETRY_RUNS_DIR || path.join(__dirname, 'runs');

function defaultRunId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `run_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

function listRunIds(runsDir) {
  try {
    if (!fs.existsSync(runsDir)) return [];
    return fs
      .readdirSync(runsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

function tryReadJson(fp) {
  try {
    if (!fs.existsSync(fp)) return null;
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return null;
  }
}

async function readEventsJsonl(eventsPath, { limit = 20000, types = null } = {}) {
  const out = [];
  if (!fs.existsSync(eventsPath)) return out;
  const rl = readline.createInterface({
    input: fs.createReadStream(eventsPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (out.length >= limit) break;
    const trimmed = line.trim();
    if (!trimmed) continue;
    let evt;
    try {
      evt = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (types && Array.isArray(types) && types.length > 0) {
      if (!types.includes(evt.type)) continue;
    }
    out.push(evt);
  }
  return out;
}

// Minimal REST API for visualization pages
app.get('/api/runs', (req, res) => {
  const runIds = listRunIds(RUNS_DIR);
  const runs = runIds.map((runId) => {
    const runDir = path.join(RUNS_DIR, runId);
    const meta = tryReadJson(path.join(runDir, 'meta.json'));
    const eventsPath = path.join(runDir, 'events.jsonl');
    const stat = fs.existsSync(eventsPath) ? fs.statSync(eventsPath) : null;
    return {
      runId,
      startedAt: meta?.startedAt ?? null,
      eventsBytes: stat?.size ?? null,
    };
  });
  res.json({ runs });
});

app.get('/api/runs/:runId/meta', (req, res) => {
  const runId = req.params.runId;
  const runDir = path.join(RUNS_DIR, runId);
  const meta = tryReadJson(path.join(runDir, 'meta.json'));
  if (!meta) return res.status(404).json({ error: 'meta not found' });
  res.json({ meta });
});

app.get('/api/runs/:runId/events', async (req, res) => {
  const runId = req.params.runId;
  const runDir = path.join(RUNS_DIR, runId);
  const eventsPath = path.join(runDir, 'events.jsonl');
  if (!fs.existsSync(eventsPath)) return res.status(404).json({ error: 'events not found' });

  const limit = Math.max(1, Math.min(100000, Number(req.query.limit || 20000)));
  const types = typeof req.query.types === 'string' ? req.query.types.split(',').map((s) => s.trim()).filter(Boolean) : null;
  const events = await readEventsJsonl(eventsPath, { limit, types });
  res.json({ runId, events, truncated: events.length >= limit });
});

const telemetry = new TelemetryService({ runsDir: RUNS_DIR });
const ms = new MindServerClient({ host: MINDSERVER_HOST, port: MINDSERVER_PORT });
const collectors = getCollectorRegistry();
const metricsEngine = new MetricsEngine(getMetricRegistry());

const agentSettingsCache = new Map(); // agentName -> settings

function getAgentTask(agentName) {
  return agentSettingsCache.get(agentName)?.task || null;
}

function appendIfRecording(event) {
  telemetry.append(event);
}

telemetry.onEvent((event) => {
  try {
    metricsEngine.applyEvent(event);
  } catch (e) {
    // swallow metric engine errors; they should not break logging
  }
});

// Minimal v0: log raw stream events so we can validate connectivity and run logging.
ms.on('connect', () => {
  if (telemetry.isRecording()) {
    telemetry.append(makeEvent('mindserver_connected', {}));
  }
});
ms.on('disconnect', () => {
  if (telemetry.isRecording()) {
    telemetry.append(makeEvent('mindserver_disconnected', {}));
  }
});
ms.on('agentsStatus', (agents) => {
  if (!telemetry.isRecording()) return;
  telemetry.append(makeEvent('agents_status', { agents }));
  for (const a of agents || []) {
    const name = a?.name;
    if (!name || agentSettingsCache.has(name) === true) continue;
    // Best-effort fetch. Failure should not break telemetry.
    ms.getAgentSettings(name)
      .then((s) => {
        agentSettingsCache.set(name, s);
        if (telemetry.isRecording()) {
          telemetry.append(makeEvent('agent_settings', { agent_name: name, task_id: s?.task?.task_id || null }));
        }
      })
      .catch((e) => {
        if (telemetry.isRecording()) {
          telemetry.append(makeEvent('error', { where: 'get-settings', agent_name: name, message: String(e?.message || e) }));
        }
      });
  }
});
ms.on('botOutput', (agentName, message) => {
  if (!telemetry.isRecording()) return;
  telemetry.append(makeEvent('bot_output', { agent_name: agentName, message }));
});
ms.on('stateUpdate', (states) => {
  if (!telemetry.isRecording()) return;
  telemetry.append(makeEvent('state_update', { states }));
  const runId = telemetry.getRunInfo()?.runId;
  for (const c of collectors) {
    try {
      c.onStateUpdate?.({ runId, states, append: appendIfRecording, getAgentTask });
    } catch (e) {
      telemetry.append(makeEvent('error', { where: `collector:${c.id}`, message: String(e?.message || e) }));
    }
  }
});

async function ensureMindServerConnected() {
  if (ms.connected) return;
  await ms.connect();
  ms.subscribeToState();
}

function statusPayload() {
  return {
    plugin: { port: TELEMETRY_PORT },
    mindserver: { host: MINDSERVER_HOST, port: MINDSERVER_PORT, connected: ms.connected },
    recording: telemetry.isRecording(),
    run: telemetry.getRunInfo(),
    metrics: metricsEngine.snapshot(),
  };
}

io.on('connection', (socket) => {
  socket.on('telemetry:getStatus', (cb) => {
    const payload = statusPayload();
    socket.emit('telemetry:status', payload);
    if (typeof cb === 'function') cb(payload);
  });

  socket.on('telemetry:start', async ({ runId } = {}, cb) => {
    try {
      await ensureMindServerConnected();
      const effectiveRunId = (runId || '').trim() || defaultRunId();
      telemetry.startRun({
        runId: effectiveRunId,
        meta: {
          mindserver: { host: MINDSERVER_HOST, port: MINDSERVER_PORT },
        },
      });
      // reset caches per run
      agentSettingsCache.clear();
      metricsEngine.resetAll();
      io.emit('telemetry:status', statusPayload());
      if (typeof cb === 'function') cb({ ok: true });
    } catch (e) {
      if (typeof cb === 'function') cb({ ok: false, error: String(e?.message || e) });
    }
  });

  socket.on('telemetry:stop', ({ reason } = {}, cb) => {
    try {
      for (const c of collectors) {
        try {
          c.onRunStop?.({ append: appendIfRecording });
        } catch (e) {
          // swallow
        }
      }
      telemetry.stopRun({ reason: reason || 'user_stop' });
      io.emit('telemetry:status', statusPayload());
      if (typeof cb === 'function') cb({ ok: true });
    } catch (e) {
      if (typeof cb === 'function') cb({ ok: false, error: String(e?.message || e) });
    }
  });

  socket.on('telemetry:getConfig', (cb) => {
    const payload = {
      collectors: collectors.map((c) => c.getMeta?.() || { id: c.id, label: c.label, enabledByDefault: true }),
      metrics: metricsEngine.getConfig(),
    };
    if (typeof cb === 'function') cb(payload);
  });

  // Push initial status
  socket.emit('telemetry:status', statusPayload());
});

server.listen(TELEMETRY_PORT, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`Telemetry plugin running on http://127.0.0.1:${TELEMETRY_PORT}`);
});


