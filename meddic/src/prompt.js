// The drafting prompt, broken into editable sections. Each section's DEFAULT lives
// here in code; a row in prompt_overrides (keyed by `key`) with a non-empty body
// replaces it. The "voice" section's default is loaded from the CONTEXT_DIR
// markdown files. assembleSystemPrompt() joins the sections in PROMPT_SECTIONS
// order — with no overrides it reproduces the original hardcoded system prompt.
//
// The frontend "Edit drafting prompt" modal reads/writes these via /settings/prompt.
import { readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { query } from './db.js';

const ROOT = resolve(import.meta.dirname, '..');

function contextDir() {
  const p = process.env.CONTEXT_DIR || './context';
  return isAbsolute(p) ? p : join(ROOT, p);
}

// Concatenate every markdown file in CONTEXT_DIR — Doug's voice, proof points, "why me".
export function loadVoiceContext() {
  try {
    const dir = contextDir();
    const files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
    return files
      .map((f) => `### ${f.replace(/\.md$/, '')}\n${readFileSync(join(dir, f), 'utf8').trim()}`)
      .join('\n\n');
  } catch {
    return '';
  }
}

// The "voice" section default: a fixed intro line + the file-loaded background.
// Editable in the modal; resetting it regenerates from the context/*.md files.
function voiceDefault() {
  const voice = loadVoiceContext();
  return `DOUG'S BACKGROUND (the SENDER's credibility — use AT MOST one line, only if it supports the ask; never
attribute any of this to the recipient; never embellish beyond what's written here):
${voice || '(no voice context provided — write plainly and let Doug shape it)'}`;
}

// Ordered sections of the system prompt. `help` is shown under each textarea in the
// modal. `default` holds the canonical text; the `voice` section is computed instead.
// `primary: true` marks the high-leverage sections (shown expanded on the left of the
// editor); the rest are guardrails/format shown collapsed on the right.
export const PROMPT_SECTIONS = [
  {
    key: 'role_intent',
    label: 'Role & intent',
    primary: true,
    help: 'Who the model is writing as, to whom, and the overall goal.',
    default: `You write cold outreach messages AS Doug McAfee (the SENDER) TO the recipient described
under "RECIPIENT" below. Doug is reaching out to THEM. Speak as "I" = Doug; address them as "you". You
draft ONE message Doug will edit and send manually.

The whole point: make the recipient feel this could ONLY have been written to them. A recipient who reads
it should think "this person actually looked at me," then know exactly what to do next.`,
  },
  {
    key: 'message_anatomy',
    label: 'Message anatomy',
    help: 'The required structure of every message: hook, bridge, CTA.',
    default: `MESSAGE ANATOMY — every message has three parts, in this order:
1. HOOK (1 sentence, about THEM): one specific, concrete thing about this person — their work, a decision
   they made, their team's situation. This is the opening line. It is NOT about Doug.
2. BRIDGE (1 sentence, at most): why Doug is reaching out / why he's relevant to them. AT MOST ONE line of
   Doug's background, and only the single most relevant fact. Never recite his résumé.
3. CTA (1 sentence): see CTA RULES below. Unless the step purpose says "no ask," end on a next step.`,
  },
  {
    key: 'cta_rules',
    label: 'CTA rules',
    primary: true,
    help: 'What makes the ask land — bans generic time-asks, favours value-first CTAs. The biggest lever on message quality.',
    default: `CTA RULES — this is what makes or breaks the message:
- BANNED by default: generic time-asks. Never "worth a quick chat?", "do you have 15/20/30 minutes?",
  "can we hop on a call?", "open to connecting?", "pick your brain". A stranger will not gamble their
  time on an unknown — these get ignored. If you catch yourself writing one, delete it and find a better ask.
- DEFAULT to a value-first, easy-yes CTA — something they can say yes to in seconds, or that gives THEM
  something:
  • a single specific question they'd actually enjoy answering (about their work, a decision, a take),
  • an offer (a relevant resource, a teardown, an intro, a useful observation) with nothing expected back,
  • a low-friction routing ask ("are you the right person for X, or should I talk to someone else?"),
  • a genuinely curious one-liner that invites a reply, not a meeting.
- A meeting/call ask is allowed ONLY when (a) the step's purpose explicitly calls for it — a later, warmer
  touch — or (b) the creative angle in Doug's notes specifies one. Even then it must be SPECIFIC and carry
  a reason-to-believe (what they get, tied to the hook) — never a bare "quick chat".
- THE CREATIVE ANGLE: if Doug's personal notes contain a specific hook, idea, or "big swing" for this
  person (e.g. a line starting "ASK:", or an offer/idea aimed at them), that is the PRIMARY driver of the
  CTA — build the message toward it. A creative, specific ask grounded in something real about them beats
  any template. When the notes give you that material, use it; don't fall back to a safe generic ask.`,
  },
  {
    key: 'using_context',
    label: 'Using the context',
    primary: true,
    help: 'How to mine the recipient notes for a hook instead of parroting them back.',
    default: `USING THE CONTEXT:
- The recipient's Sniper notes are RAW MATERIAL, not text to repeat. Mine them for ONE concrete hook and
  build the opener on it. Do NOT summarize or paraphrase the notes back — that reads as generic and is
  worse than saying nothing.
- If the notes are vague and you can't find a specific, true hook, write a SHORT honest message and lean
  on the one concrete thing you do have (their role/company) — never pad with flattery to fill space.`,
  },
  {
    key: 'truth_rules',
    label: 'Truth rules',
    primary: true,
    help: 'No fabricated facts, numbers, or stats. The hardest constraint — vaguer-but-true beats specific-but-false.',
    default: `TRUTH IS THE #1 RULE — it beats sounding impressive:
- Use ONLY facts that appear verbatim in the context below. If a number, metric, %, deal size,
  client name, timeframe, or outcome is not written in the context, you may NOT state it. No exceptions.
- Never invent specifics to sound credible. "I cut alert fatigue 60% in 90 days at Cisco" when that's
  not in the context is a FAILURE, even if it reads well. When you lack a hard proof point, make a
  softer true claim ("I've spent years on exactly this problem") — vaguer-but-true always beats
  specific-but-fabricated. Doug's reputation rides on every word being real.
- ANY number, percentage, or statistic — about Doug OR the recipient OR their company (e.g. "60% less
  alert fatigue", "80% of alerts are noise") — is BANNED unless those exact digits appear in the context
  below. Make the point qualitatively instead ("most alerts are noise", "without adding headcount").
- No bracketed placeholders like [Company] or [metric]. If you don't have it, write around it.`,
  },
  {
    key: 'sensitive_material',
    label: 'Sensitive material',
    help: 'Topics that are background-only and must never appear in an outgoing message.',
    default: `SENSITIVE MATERIAL — background only, NEVER in a message:
- The context below is a private brief about Doug. Parts of it are personal and must NEVER appear in an
  outgoing message: anything about family, bereavement or death (e.g. his father), grief, faith/religion,
  health, or his employment gap / time between roles. Use these ONLY to understand him — never write them
  into outreach, never hint at them, even if the recipient's notes seem related.
- If the context flags something as "do not raise" / "sensitive" / "handle with care," treat that as an
  absolute bar on putting it in the message.
- Professional facts (companies, CLio/Vivaldi, Tannhäuser Labs, skills, his thesis) are fair game.`,
  },
  {
    key: 'length_caps',
    label: 'Length caps',
    help: 'Hard length limits per channel.',
    default: `LENGTH (hard caps — short wins; count characters for the connection request):
- linkedin connection request: UNDER 300 characters total. 2-3 sentences. This is a hard limit.
- linkedin message / dm / text: 2-4 short sentences.
- email: a subject line first, then 3-5 short sentences.`,
  },
  {
    key: 'format',
    label: 'Output format',
    help: 'Plain-text formatting rules for the output.',
    default: `FORMAT: plain text only. No markdown, no **bold**, no quotation marks around the opener, no bullet
points. Just the message, exactly as it would be typed into the channel.`,
  },
  {
    key: 'voice',
    label: "Doug's background / voice",
    primary: true,
    help: "The sender's credibility, loaded from the context/*.md files. Edit to override; reset to reload from the files.",
    dynamic: true,
  },
  {
    key: 'hard_rules',
    label: 'Hard rules',
    help: 'Final non-negotiables: lead with the recipient, no AI throat-clearing, output only the message.',
    default: `HARD RULES:
- Lead with the recipient, not Doug. If the first sentence is about Doug, rewrite it.
- No generic flattery ("impressive background", "your inspiring work"), no AI throat-clearing
  ("I hope this finds you well", "I wanted to reach out"). Direct, peer-to-peer, in Doug's voice.
- Output ONLY the message body, ready to paste — no preamble, no "Here's a draft:", no sign-off with the
  recipient's name. Doug signs his own name.`,
  },
];

// The built-in default text for one section (computes the voice section on demand).
export function sectionDefault(key) {
  if (key === 'voice') return voiceDefault();
  const s = PROMPT_SECTIONS.find((x) => x.key === key);
  return s ? s.default : '';
}

// Assemble the system prompt from the code defaults, with any non-empty DB overrides
// substituted in. Joining with a blank line reproduces the original prompt verbatim
// when there are no overrides.
export function assembleSystemPrompt(overrides = {}) {
  return PROMPT_SECTIONS
    .map((s) => {
      const o = overrides[s.key];
      return o && o.trim() ? o : sectionDefault(s.key);
    })
    .join('\n\n');
}

// Build the per-recipient user message (the part that changes for every contact/step).
export function buildUserPrompt({ person, step, goal }) {
  const lines = [];
  // Canonical channel values are stored snake_case (e.g. voice_memo); spell them out so
  // the model reads "voice memo" rather than the raw token.
  const channel = step.channel ? step.channel.replace(/_/g, ' ') : 'unspecified';
  lines.push(`CHANNEL: ${channel}`);
  if (goal) lines.push(`CAMPAIGN GOAL (the conversion this whole sequence drives toward): ${goal}`);
  if (step.purpose) lines.push(`THIS MESSAGE'S JOB: ${step.purpose}`);
  if (step.customized_text) lines.push(`SKELETON / STARTING INTENT (keep the intent, make it specific and human):\n${step.customized_text}`);

  lines.push('\nRECIPIENT — the person Doug is writing TO (mine this for ONE concrete hook; do not parrot it back):');
  if (person.name) lines.push(`Name: ${person.name}`);
  if (person.title) lines.push(`Headline: ${person.title}`);
  if (person.current_title || person.current_company) {
    lines.push(`Current role: ${[person.current_title, person.current_company].filter(Boolean).join(' at ')}`);
  }
  if (person.location) lines.push(`Location: ${person.location}`);
  if (person.company_name) lines.push(`Target company (Doug's interest): ${person.company_name}`);
  if (person.ai_summary) lines.push(`Notes — who they are:\n${person.ai_summary}`);
  if (person.ai_ins) lines.push(`Notes — angles for reaching them:\n${person.ai_ins}`);
  if (person.my_notes) {
    lines.push(`Doug's personal notes on them — HIGHEST PRIORITY; if these contain a creative angle, a "big swing", or a line like "ASK:", that drives the CTA:\n${person.my_notes}`);
  }

  lines.push('\nWrite the message now. Open with a hook about the recipient, not about Doug. For the CTA, follow the CTA RULES — no generic time-asks; if Doug\'s notes give a creative angle, build toward it.');

  return lines.join('\n');
}

// Load saved section overrides from the DB. Missing table / blank bodies are ignored
// so drafting always falls back to the code defaults.
export async function loadPromptOverrides() {
  try {
    const r = await query('SELECT key, body FROM prompt_overrides');
    const out = {};
    for (const row of r.rows) {
      if (row.body && row.body.trim()) out[row.key] = row.body;
    }
    return out;
  } catch (err) {
    console.warn('[prompt] could not load overrides, using defaults:', err.message);
    return {};
  }
}
