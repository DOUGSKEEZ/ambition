import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import express from 'express';
import cors from 'cors';
import captureRouter from './routes/capture.js';
import companiesRouter from './routes/companies.js';
import peopleRouter from './routes/people.js';
import { startWatcher } from './watcher.js';

const ROOT = resolve(import.meta.dirname, '..');
const PORT = process.env.PORT || 7700;

const mediaDir = (() => {
  const p = process.env.MEDIA_DIR || './media';
  const dir = isAbsolute(p) ? p : join(ROOT, p);
  mkdirSync(dir, { recursive: true });
  return dir;
})();

const app = express();

app.use(cors()); // permissive: extension background worker POSTs cross-host
app.use(express.json({ limit: '30mb' })); // full outerHTML + base64 photo

// API
app.use('/capture', captureRouter);
app.use('/companies', companiesRouter);
app.use('/people', peopleRouter);

// Static: profile photos and the review SPA.
app.use('/media', express.static(mediaDir));
app.use(express.static(join(ROOT, 'public')));

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[sniper] listening on http://0.0.0.0:${PORT}`);
  startWatcher();
});
