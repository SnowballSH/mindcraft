# Telemetry Sidecar Plugin

Standalone telemetry + metrics sidecar for Mindcraft.

## What it does
- Connects to the running MindServer via Socket.IO
- Subscribes to `state-update` and `bot-output`
- Logs a run-scoped append-only JSONL event stream
- Exposes a small web UI for starting/stopping recording and viewing status

## Run
From repo root:

```bash
npm run telemetry
```

Environment variables:
- `MINDSERVER_PORT` (default: `8080`)
- `MINDSERVER_HOST` (default: `localhost`)
- `TELEMETRY_PORT` (default: `8090`)
- `TELEMETRY_RUNS_DIR` (default: `plugins/telemetry/runs`)

## Offline replay (metrics from a run log)
After you’ve recorded a run, replay metrics from `events.jsonl`:

```bash
node plugins/telemetry/cli/replay.js --input plugins/telemetry/runs/<run_id>/events.jsonl
```


