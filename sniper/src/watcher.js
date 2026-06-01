// Inbox file-watcher fallback: ingest any *.json dropped into INBOX_DIR.
// Covers blocked POSTs and manual "Save Page As" -> hand-built payload.
import { mkdirSync, readFileSync, renameSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import chokidar from 'chokidar';
import { ingest } from './capture.js';

const ROOT = resolve(import.meta.dirname, '..');

function dir(p, fallback) {
  const v = isAbsolute(p || fallback) ? (p || fallback) : join(ROOT, p || fallback);
  mkdirSync(v, { recursive: true });
  return v;
}

export function startWatcher() {
  const inbox = dir(process.env.INBOX_DIR, './inbox');
  const processedDir = join(inbox, 'processed');
  const failedDir = join(inbox, 'failed');
  mkdirSync(processedDir, { recursive: true });
  mkdirSync(failedDir, { recursive: true });

  const watcher = chokidar.watch(inbox, {
    depth: 0,
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
  });

  watcher.on('add', async (path) => {
    if (!path.endsWith('.json')) return;
    const base = path.split('/').pop();
    try {
      const payload = JSON.parse(readFileSync(path, 'utf8'));
      await ingest(payload);
      renameSync(path, join(processedDir, base));
      console.log(`[watcher] ingested ${base}`);
    } catch (err) {
      console.error(`[watcher] failed ${base}: ${err.message}`);
      try {
        renameSync(path, join(failedDir, base));
      } catch {
        /* leave file in place */
      }
    }
  });

  console.log(`[watcher] watching ${inbox}`);
  return watcher;
}
