import 'dotenv/config';
import { join, resolve } from 'node:path';
import express from 'express';
import cors from 'cors';
import companiesRouter from './routes/companies.js';
import metricsRouter from './routes/metrics.js';

const ROOT = resolve(import.meta.dirname, '..');
const PORT = process.env.PORT || 7702;

const app = express();
app.use(cors());
app.use(express.json());

// API
app.use('/companies', companiesRouter);
app.use('/metrics', metricsRouter);

app.use(express.static(join(ROOT, 'public')));
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[engineer] analytics on http://0.0.0.0:${PORT}`);
});
