import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BT_DIR = path.resolve(__dirname, '../../src_ts/behavior_trees');
const VAR_PATTERN = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

let _cache = null; // { loadedAtMs, entries: [...] }

function extractBtId(xml) {
  const m = String(xml).match(/<BehaviorTree\b[^>]*\bID="([^"]+)"/i);
  return m ? m[1] : null;
}

function extractVars(xml) {
  const vars = new Set();
  const s = String(xml);
  let m;
  while ((m = VAR_PATTERN.exec(s)) !== null) {
    vars.add(m[1]);
  }
  return [...vars].sort();
}

export async function loadBtCatalog({ force = false } = {}) {
  if (!force && _cache) return _cache.entries;

  let files = [];
  try {
    files = await readdir(BT_DIR);
  } catch (e) {
    throw new Error(`BT directory not found: ${BT_DIR}. Error: ${String(e)}`);
  }

  const entries = [];
  const seenById = new Map(); // id -> path
  const duplicates = [];
  for (const f of files) {
    if (!f.endsWith('.xml')) continue;
    const fullPath = path.join(BT_DIR, f);
    const xml = await readFile(fullPath, 'utf8');
    const id = extractBtId(xml);
    if (!id) continue;
    const relPath = `src_ts/behavior_trees/${f}`;
    const prev = seenById.get(id);
    if (prev) {
      duplicates.push({ id, first: prev, second: relPath });
      continue;
    }
    seenById.set(id, relPath);
    entries.push({
      id,
      // Use project-relative paths so they’re stable to show to the user/LLM.
      path: relPath,
      vars: extractVars(xml),
    });
  }

  if (duplicates.length > 0) {
    const lines = duplicates.map((d) => `- ${d.id}: ${d.first} AND ${d.second}`);
    throw new Error(`Duplicate <BehaviorTree ID> detected:\n${lines.join('\n')}`);
  }

  entries.sort((a, b) => a.id.localeCompare(b.id));
  _cache = { loadedAtMs: Date.now(), entries };
  return entries;
}

export async function getBtById(btId) {
  const entries = await loadBtCatalog();
  const found = entries.find((e) => e.id === btId);
  return found ?? null;
}


