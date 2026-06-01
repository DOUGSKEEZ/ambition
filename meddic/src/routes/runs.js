// Person runs (assignments) and their per-step send tracking.
// Absolute paths so they read naturally: /people/:id/assign, /person-campaign-steps/:id.
import { Router } from 'express';
import { query, pool } from '../db.js';

const router = Router();

// POST /people/:id/assign  { campaign_id|null, start_step }
// Archives any current active run, creates a fresh run, and copies the campaign's steps
// (from start_step onward) into the run as the customized starting text. campaign_id null
// => bespoke run with a single blank step to write from scratch.
router.post('/people/:id/assign', async (req, res) => {
  const client = await pool.connect();
  try {
    const personId = req.params.id;
    const { campaign_id = null, start_step = 1 } = req.body || {};

    const person = await client.query("SELECT id FROM people WHERE id = $1", [personId]);
    if (!person.rowCount) return res.status(404).json({ error: 'person not found' });

    await client.query('BEGIN');

    // Archive the existing active run (preserved, never deleted — Sniper's reject/restage ethos).
    await client.query(
      `UPDATE person_campaigns SET status = 'archived', archived_at = NOW()
       WHERE person_id = $1 AND status = 'active'`,
      [personId]
    );

    const run = await client.query(
      `INSERT INTO person_campaigns (person_id, campaign_id, status, current_step, started_at)
       VALUES ($1, $2, 'active', $3, NOW()) RETURNING *`,
      [personId, campaign_id, start_step]
    );
    const runId = run.rows[0].id;

    if (campaign_id) {
      // Copy skeleton steps (>= start_step) into the run as customized_text seeds.
      const steps = await client.query(
        'SELECT * FROM campaign_steps WHERE campaign_id = $1 AND step_order >= $2 ORDER BY step_order',
        [campaign_id, start_step]
      );
      for (const s of steps.rows) {
        await client.query(
          `INSERT INTO person_campaign_steps
             (person_campaign_id, step_order, channel, purpose, customized_text, delay_days)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [runId, s.step_order, s.channel, s.purpose, s.skeleton_text, s.default_delay_days]
        );
      }
    } else {
      // Bespoke: one blank step to start.
      await client.query(
        `INSERT INTO person_campaign_steps (person_campaign_id, step_order, channel, purpose, customized_text)
         VALUES ($1, 1, NULL, NULL, NULL)`,
        [runId]
      );
    }

    await client.query('COMMIT');

    const steps = await query(
      'SELECT * FROM person_campaign_steps WHERE person_campaign_id = $1 ORDER BY step_order',
      [runId]
    );
    res.status(201).json({ ...run.rows[0], steps: steps.rows });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[POST /people/:id/assign]', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// GET /people/:id/runs — run history (active + archived) for the switch/history view.
router.get('/people/:id/runs', async (req, res) => {
  try {
    const result = await query(
      `SELECT pc.*, cam.name AS campaign_name
       FROM person_campaigns pc LEFT JOIN campaigns cam ON cam.id = pc.campaign_id
       WHERE pc.person_id = $1 ORDER BY pc.started_at DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[GET /people/:id/runs]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /person-campaign-steps  { person_campaign_id } — append a blank step (bespoke building).
router.post('/person-campaign-steps', async (req, res) => {
  try {
    const { person_campaign_id } = req.body || {};
    if (!person_campaign_id) return res.status(400).json({ error: 'person_campaign_id required' });
    const m = await query(
      'SELECT COALESCE(MAX(step_order),0)+1 AS n FROM person_campaign_steps WHERE person_campaign_id = $1',
      [person_campaign_id]
    );
    const result = await query(
      'INSERT INTO person_campaign_steps (person_campaign_id, step_order) VALUES ($1, $2) RETURNING *',
      [person_campaign_id, m.rows[0].n]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[POST /person-campaign-steps]', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /person-campaign-steps/:id — edit customized_text / channel / purpose / send + response tracking.
// sent_at is ALWAYS taken from the client (manually editable, never inferred). Marking sent also
// advances the run's current_step and bumps the person's last_action_at + suggests next_action_date.
router.put('/person-campaign-steps/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const fields = ['customized_text', 'channel', 'purpose', 'sent', 'sent_at',
      'response_received', 'response_at', 'step_notes', 'delay_days', 'step_order'];
    const body = req.body || {};
    const updates = Object.entries(body).filter(([k]) => fields.includes(k));
    if (!updates.length) return res.status(400).json({ error: 'no editable fields provided' });

    await client.query('BEGIN');

    const sets = updates.map(([k], i) => `${k} = $${i + 2}`);
    const values = updates.map(([k, v]) => {
      if (v === '') return null;
      return v;
    });
    const upd = await client.query(
      `UPDATE person_campaign_steps SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
      [req.params.id, ...values]
    );
    if (!upd.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'not found' }); }
    const step = upd.rows[0];

    // Side effects when a step is freshly marked sent.
    if (body.sent === true) {
      const run = await client.query('SELECT * FROM person_campaigns WHERE id = $1', [step.person_campaign_id]);
      if (run.rowCount) {
        const personId = run.rows[0].person_id;
        const sentAt = step.sent_at || new Date().toISOString();
        // Advance current_step to the next step if this one is the current or beyond.
        await client.query(
          'UPDATE person_campaigns SET current_step = GREATEST(current_step, $2) WHERE id = $1',
          [step.person_campaign_id, step.step_order + 1]
        );
        // Suggest next_action_date from this step's delay (or the next step's delay).
        const next = await client.query(
          'SELECT delay_days FROM person_campaign_steps WHERE person_campaign_id = $1 AND step_order = $2',
          [step.person_campaign_id, step.step_order + 1]
        );
        const delay = next.rows[0]?.delay_days ?? step.delay_days ?? null;
        await client.query(
          `UPDATE people SET last_action_at = $2::timestamptz,
             next_action_date = CASE WHEN $3::int IS NOT NULL THEN ($2::timestamptz::date + $3::int) ELSE next_action_date END
           WHERE id = $1`,
          [personId, sentAt, delay]
        );
      }
    }

    await client.query('COMMIT');
    res.json(step);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[PUT /person-campaign-steps/:id]', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

export default router;
