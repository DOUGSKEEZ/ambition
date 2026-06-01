// Seed three starter campaigns (recruiter / peer / hiring_manager) for testing.
// Idempotent: skips a campaign whose name already exists.
import 'dotenv/config';
import { pool } from '../src/db.js';

const CAMPAIGNS = [
  {
    name: 'Recruiter — warm intro',
    category: 'recruiter',
    goal: 'Get on the recruiter\'s radar as a low-risk, easy-to-advance candidate and land a screen.',
    steps: [
      { channel: 'linkedin', purpose: 'Connection request', skeleton_text: 'Short, specific note referencing a role they\'re hiring for and one concrete signal Doug fits.', default_delay_days: 0 },
      { channel: 'linkedin', purpose: 'Value follow-up', skeleton_text: 'After connect: one proof point tied to what they screen for; offer to make their job easy.', default_delay_days: 3 },
      { channel: 'email', purpose: 'Screen ask', skeleton_text: 'Direct ask for a 15-min screen; link to one artifact that reduces their research.', default_delay_days: 4 },
    ],
  },
  {
    name: 'Peer — referral path',
    category: 'peer',
    goal: 'Build a real relationship and earn a genuine internal referral.',
    steps: [
      { channel: 'linkedin', purpose: 'Connect on shared ground', skeleton_text: 'Reference shared background/path; no ask.', default_delay_days: 0 },
      { channel: 'linkedin', purpose: 'Curious question', skeleton_text: 'Ask about their story / how they got in — genuine, specific.', default_delay_days: 4 },
      { channel: 'linkedin', purpose: 'Soft referral ask', skeleton_text: 'After real exchange: ask how they\'d suggest navigating their team.', default_delay_days: 5 },
    ],
  },
  {
    name: 'Hiring manager — value-first',
    category: 'hiring_manager',
    goal: 'Open a value-first conversation and get a meeting.',
    steps: [
      { channel: 'linkedin', purpose: 'Connect with a hook', skeleton_text: 'Lead with their likely priority/pain; one line on why Doug\'s dual-threat fits.', default_delay_days: 0 },
      { channel: 'email', purpose: 'Value-first note', skeleton_text: 'A specific idea or observation relevant to their team; no hard ask yet.', default_delay_days: 3 },
      { channel: 'email', purpose: 'Meeting ask', skeleton_text: 'Direct ask for 20 minutes; tie to the value floated earlier.', default_delay_days: 5 },
    ],
  },
];

async function run() {
  let created = 0;
  for (const c of CAMPAIGNS) {
    const exists = await pool.query('SELECT id FROM campaigns WHERE name = $1', [c.name]);
    if (exists.rowCount) { console.log(`[seed] skip "${c.name}" (exists)`); continue; }
    const cam = await pool.query(
      'INSERT INTO campaigns (name, category, goal) VALUES ($1,$2,$3) RETURNING id',
      [c.name, c.category, c.goal]
    );
    const id = cam.rows[0].id;
    for (let i = 0; i < c.steps.length; i++) {
      const s = c.steps[i];
      await pool.query(
        `INSERT INTO campaign_steps (campaign_id, step_order, channel, purpose, skeleton_text, default_delay_days)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, i + 1, s.channel, s.purpose, s.skeleton_text, s.default_delay_days]
      );
    }
    created++;
    console.log(`[seed] created "${c.name}" (${c.steps.length} steps)`);
  }
  console.log(`[seed] done (${created} created)`);
  await pool.end();
}

run().catch((err) => { console.error('[seed] failed:', err.message); process.exit(1); });
