#!/usr/bin/env node
import fs from 'fs';
import readline from 'readline';

import { getMetricRegistry } from '../metrics/metrics_registry.js';
import { MetricsEngine } from '../metrics/metrics_engine.js';

function parseArgs(argv) {
  const args = { input: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input' || a === '-i') args.input = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.input) {
    // eslint-disable-next-line no-console
    console.error('Usage: node plugins/telemetry/cli/replay.js --input <events.jsonl>');
    process.exit(2);
  }

  const engine = new MetricsEngine(getMetricRegistry());
  engine.resetAll();

  const rl = readline.createInterface({
    input: fs.createReadStream(args.input, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const event = JSON.parse(trimmed);
    engine.applyEvent(event);
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(engine.snapshot(), null, 2));
}

await main();


