// Drafting layer — the accuracy engine. Assembles a context package (Doug's voice +
// the target's Sniper enrichment + the step's purpose/skeleton/goal) and calls the
// configured provider. Provider is a config swap, not a code change.
import { readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

function contextDir() {
  const p = process.env.CONTEXT_DIR || './context';
  return isAbsolute(p) ? p : join(ROOT, p);
}

// Concatenate every markdown file in CONTEXT_DIR — Doug's voice, proof points, "why me".
function loadVoiceContext() {
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

// Build the system + user messages for a draft from the assembled context package.
export function buildDraftMessages({ voice, person, step, goal }) {
  const system = `You write cold outreach messages AS Doug McAfee (the SENDER) TO the recipient described
under "RECIPIENT" below. Doug is reaching out to THEM. Speak as "I" = Doug; address them as "you". You
draft ONE message Doug will edit and send manually.

The whole point: make the recipient feel this could ONLY have been written to them. A recipient who reads
it should think "this person actually looked at me," then know exactly what to do next.

MESSAGE ANATOMY — every message has three parts, in this order:
1. HOOK (1 sentence, about THEM): one specific, concrete thing about this person — their work, a decision
   they made, their team's situation. This is the opening line. It is NOT about Doug.
2. BRIDGE (1 sentence, at most): why Doug is reaching out / why he's relevant to them. AT MOST ONE line of
   Doug's background, and only the single most relevant fact. Never recite his résumé.
3. CTA (1 sentence): see CTA RULES below. Unless the step purpose says "no ask," end on a next step.

CTA RULES — this is what makes or breaks the message:
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
  any template. When the notes give you that material, use it; don't fall back to a safe generic ask.

USING THE CONTEXT:
- The recipient's Sniper notes are RAW MATERIAL, not text to repeat. Mine them for ONE concrete hook and
  build the opener on it. Do NOT summarize or paraphrase the notes back — that reads as generic and is
  worse than saying nothing.
- If the notes are vague and you can't find a specific, true hook, write a SHORT honest message and lean
  on the one concrete thing you do have (their role/company) — never pad with flattery to fill space.

TRUTH IS THE #1 RULE — it beats sounding impressive:
- Use ONLY facts that appear verbatim in the context below. If a number, metric, %, deal size,
  client name, timeframe, or outcome is not written in the context, you may NOT state it. No exceptions.
- Never invent specifics to sound credible. "I cut alert fatigue 60% in 90 days at Cisco" when that's
  not in the context is a FAILURE, even if it reads well. When you lack a hard proof point, make a
  softer true claim ("I've spent years on exactly this problem") — vaguer-but-true always beats
  specific-but-fabricated. Doug's reputation rides on every word being real.
- ANY number, percentage, or statistic — about Doug OR the recipient OR their company (e.g. "60% less
  alert fatigue", "80% of alerts are noise") — is BANNED unless those exact digits appear in the context
  below. Make the point qualitatively instead ("most alerts are noise", "without adding headcount").
- No bracketed placeholders like [Company] or [metric]. If you don't have it, write around it.

SENSITIVE MATERIAL — background only, NEVER in a message:
- The context below is a private brief about Doug. Parts of it are personal and must NEVER appear in an
  outgoing message: anything about family, bereavement or death (e.g. his father), grief, faith/religion,
  health, or his employment gap / time between roles. Use these ONLY to understand him — never write them
  into outreach, never hint at them, even if the recipient's notes seem related.
- If the context flags something as "do not raise" / "sensitive" / "handle with care," treat that as an
  absolute bar on putting it in the message.
- Professional facts (companies, CLio/Vivaldi, Tannhäuser Labs, skills, his thesis) are fair game.

LENGTH (hard caps — short wins; count characters for the connection request):
- linkedin connection request: UNDER 300 characters total. 2-3 sentences. This is a hard limit.
- linkedin message / dm / text: 2-4 short sentences.
- email: a subject line first, then 3-5 short sentences.

FORMAT: plain text only. No markdown, no **bold**, no quotation marks around the opener, no bullet
points. Just the message, exactly as it would be typed into the channel.

DOUG'S BACKGROUND (the SENDER's credibility — use AT MOST one line, only if it supports the ask; never
attribute any of this to the recipient; never embellish beyond what's written here):
${voice || '(no voice context provided — write plainly and let Doug shape it)'}

HARD RULES:
- Lead with the recipient, not Doug. If the first sentence is about Doug, rewrite it.
- No generic flattery ("impressive background", "your inspiring work"), no AI throat-clearing
  ("I hope this finds you well", "I wanted to reach out"). Direct, peer-to-peer, in Doug's voice.
- Output ONLY the message body, ready to paste — no preamble, no "Here's a draft:", no sign-off with the
  recipient's name. Doug signs his own name.`;

  const lines = [];
  lines.push(`CHANNEL: ${step.channel || 'unspecified'}`);
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

  return { system, user: lines.join('\n') };
}

async function callLocal({ system, user }) {
  const body = {
    model: process.env.LOCAL_LLM_MODEL || undefined,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    temperature: 0.4,
    max_tokens: 800,
  };
  const endpoints = [process.env.LOCAL_LLM_URL, process.env.LOCAL_LLM_FALLBACK_URL].filter(Boolean);
  let lastErr;
  for (const url of endpoints) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 60000);
      const res = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!res.ok) throw new Error(`LLM ${res.status}`);
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content?.trim();
      if (text) return text;
      throw new Error('empty completion');
    } catch (err) {
      lastErr = err;
      console.warn(`[draft] local ${url} failed: ${err.message}`);
    }
  }
  throw lastErr || new Error('no local endpoint');
}

async function callAnthropic({ system, user }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not set');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      max_tokens: 800,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Anthropic ${res.status} ${t}`.trim());
  }
  const data = await res.json();
  const text = (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  if (!text) throw new Error('empty Anthropic completion');
  return text;
}

/**
 * Generate a draft for one person/step.
 * @param {{person:object, step:object, goal?:string, provider?:string}} args
 * @returns {Promise<{text:string, provider:string}>}
 */
export async function generateDraft({ person, step, goal, provider }) {
  let chosen = (provider || process.env.DRAFT_PROVIDER || 'local').toLowerCase();
  const voice = loadVoiceContext();
  const messages = buildDraftMessages({ voice, person, step, goal });

  // Graceful fallback: if Claude is selected but no key is configured, fall back to local
  // so drafting keeps working until a key is added. (Explicit per-call prov:'anthropic'
  // without a key still errors loudly, so the UI surfaces the misconfig.)
  if (chosen === 'anthropic' && !process.env.ANTHROPIC_API_KEY) {
    if (provider === 'anthropic') throw new Error('Claude selected but ANTHROPIC_API_KEY is not set in .env');
    console.warn('[draft] anthropic default but no ANTHROPIC_API_KEY — falling back to local');
    chosen = 'local';
  }

  const text = chosen === 'anthropic' ? await callAnthropic(messages) : await callLocal(messages);
  return { text, provider: chosen };
}
