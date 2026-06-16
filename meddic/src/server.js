import 'dotenv/config';
import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import express from 'express';
import cors from 'cors';
import companiesRouter from './routes/companies.js';
import campaignsRouter from './routes/campaigns.js';
import peopleRouter from './routes/people.js';
import runsRouter from './routes/runs.js';
import queueRouter from './routes/queue.js';
import draftRouter from './routes/draft.js';
import settingsRouter from './routes/settings.js';

const ROOT = resolve(import.meta.dirname, '..');
const PORT = process.env.PORT || 7701;

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// API
app.use('/companies', companiesRouter);
app.use('/campaigns', campaignsRouter);
app.use('/people', peopleRouter);
app.use('/queue', queueRouter);
app.use('/draft', draftRouter);
app.use('/settings', settingsRouter);
app.use(runsRouter); // absolute paths: /person-campaigns/*, /person-campaign-steps/*

// Serve Sniper's media (same host) so contact photos render — no cross-origin, no hardcoded port.
const sniperMedia = (() => {
  const p = process.env.SNIPER_MEDIA_DIR || '../sniper/media';
  return isAbsolute(p) ? p : join(ROOT, p);
})();
if (existsSync(sniperMedia)) app.use('/media', express.static(sniperMedia));

app.use(express.static(join(ROOT, 'public')));
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[meddic] listening on http://0.0.0.0:${PORT}`);
  console.log(`[meddic] db=${(process.env.DATABASE_URL || '').replace(/:[^:@/]*@/, ':***@')} draft=${process.env.DRAFT_PROVIDER || 'local'}`);
});
