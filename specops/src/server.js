import 'dotenv/config';
import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import express from 'express';
import cors from 'cors';
import companiesRouter from './routes/companies.js';
import peopleRouter from './routes/people.js';
import opportunitiesRouter from './routes/opportunities.js';
import dividersRouter from './routes/dividers.js';
import jobPostingsRouter from './routes/job-postings.js';

const ROOT = resolve(import.meta.dirname, '..');
const PORT = process.env.PORT || 7703;

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// API
app.use('/companies', companiesRouter);
app.use('/people', peopleRouter);
app.use('/opportunities', opportunitiesRouter);
app.use('/dividers', dividersRouter);
app.use('/job-postings', jobPostingsRouter);

// Serve Sniper's media (same host) so contact photos render on opportunity cards.
const sniperMedia = (() => {
  const p = process.env.SNIPER_MEDIA_DIR || '../sniper/media';
  return isAbsolute(p) ? p : join(ROOT, p);
})();
if (existsSync(sniperMedia)) app.use('/media', express.static(sniperMedia));

app.use(express.static(join(ROOT, 'public')));
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Keep errors as JSON (matches the API) instead of Express's default HTML stack-trace page —
// most importantly for malformed request bodies, which express.json() rejects with a SyntaxError.
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ error: 'invalid JSON body' });
  }
  console.error('[unhandled]', err);
  res.status(500).json({ error: 'internal error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[specops] opportunities on http://0.0.0.0:${PORT}`);
});
