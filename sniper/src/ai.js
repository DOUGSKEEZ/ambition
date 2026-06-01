// Type-specific AI synthesis. Sends cleaned profile text to the local LLM
// (OpenAI-compatible chat/completions) and returns { summary, ins }.
import { jsonrepair } from 'jsonrepair';

const SYSTEM = `You are a sharp outreach strategist for Doug McAfee. Profile of Doug (use only what's
relevant; never repeat it back verbatim):
- A "dual-threat": a technical builder AND a strong enterprise closer. Spent the last decade closing
  complex enterprise SaaS at Cisco, Splunk, AppDynamics, and Apica.
- Moved into AI hands-on: built CLio, a multi-model AI system, and its orchestration layer Vivaldi.
- Philosophy: enterprise account management is leadership — the AE sets the cadence, tone, and
  documentation; if the first people in the room can't hold it, the deal was over before it started.
- Based in Breckenridge, Colorado. Currently building at Tannhäuser Labs. USC alum.

You analyze ONE LinkedIn profile and produce concise, specific, immediately usable outreach notes.

HARD RULES:
- Use ONLY facts present in the profile provided. Do NOT invent companies, mutuals, schools, metrics,
  or history.
- NEVER output bracketed placeholders like [Company X], [specific win], or "add a mutual here". If a
  detail isn't in the profile, omit it or speak generally — no fill-in-the-blank templates.
- No filler, no generic flattery, no hedging. Write like a smart peer, not a LinkedIn coach.
- Format both fields as short newline-separated bullet points (use "- " and real line breaks), not one
  dense paragraph.
- Always reply with a single JSON object: {"summary": "...", "ins": "..."}.`;

// Each builder returns the user-message instructions for the given contact type.
const PROMPTS = {
  recruiter: `This person is a RECRUITER.
- summary: who they are and what they most likely screen for (seniority, must-have signals, dealbreakers).
- ins: how Doug should position himself as a low-risk, easy-to-advance candidate — what concrete signals
  reduce this recruiter's effort and make Doug the obvious "move to next round" pick.`,

  peer: `This person is a PEER (someone at a target company, not the hiring decision-maker).
- summary: who they are and the shared ground Doug can build on (background, path, interests, mutuals).
- ins: natural conversation openers and what to ask about their story / how they got in — a path to
  earning a genuine referral through real conversation, not a cold ask.`,

  hiring_manager: `This person is a HIRING MANAGER.
- summary: who they are and their likely priorities and pain (what keeps them up at night for their team).
- ins: why Doug's dual-threat (technical builder + closer) profile fits those priorities, and the
  specific value-first angle to open with.`,
};

function buildUserMessage(type, fields) {
  const profile = [
    fields.name && `Name: ${fields.name}`,
    fields.title && `Headline/Title: ${fields.title}`,
    fields.location && `Location: ${fields.location}`,
    fields.current_title && `Current role: ${fields.current_title}` +
      (fields.current_company ? ` at ${fields.current_company}` : '') +
      (fields.current_tenure ? ` (${fields.current_tenure})` : ''),
    fields.previous_title && `Previous role: ${fields.previous_title}` +
      (fields.previous_company ? ` at ${fields.previous_company}` : ''),
    fields.about && `About:\n${fields.about}`,
  ].filter(Boolean).join('\n');

  const instructions = PROMPTS[type] || PROMPTS.peer;
  return `${instructions}

Format: "summary" = 2-3 short bullets. "ins" = 3-4 short bullets, each an action Doug can take.
Use real newlines between bullets. Use only facts from the PROFILE below — no placeholders.

PROFILE:
${profile || '(no profile details were parsed — keep notes minimal and say so)'}`;
}

// Extract { summary, ins } from a model's text, tolerating fences/prose around the JSON.
function parseLlmJson(text) {
  if (!text) return null;
  // Grab the outermost {...} if the model wrapped it in prose/fences.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  const candidate = start !== -1 && end !== -1 ? text.slice(start, end + 1) : text;
  for (const attempt of [candidate, text]) {
    try {
      return JSON.parse(attempt);
    } catch {
      try {
        return JSON.parse(jsonrepair(attempt));
      } catch {
        /* try next */
      }
    }
  }
  return null;
}

async function callLlm(url, body, timeoutMs = 60000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`LLM ${res.status} ${res.statusText}`);
    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? '';
  } finally {
    clearTimeout(timer);
  }
}

// Local (OpenAI-compatible) synthesis: tries LLM_URL (30B) then LLM_FALLBACK_URL (4B).
async function synthesizeLocal(messages) {
  const body = {
    model: process.env.LLM_MODEL || undefined,
    messages,
    temperature: 0.4,
    max_tokens: 600,
    response_format: { type: 'json_object' },
  };
  const endpoints = [process.env.LLM_URL, process.env.LLM_FALLBACK_URL].filter(Boolean);
  for (const url of endpoints) {
    try {
      const parsed = parseLlmJson(await callLlm(url, body));
      if (parsed && (parsed.summary || parsed.ins)) return parsed;
      console.warn(`[ai] ${url} returned unparseable content`);
    } catch (err) {
      console.warn(`[ai] ${url} failed: ${err.message}`);
    }
  }
  return null;
}

// Claude (Anthropic Messages API) synthesis.
async function synthesizeAnthropic(messages) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not set');
  const [system, user] = [messages[0].content, messages[1].content];
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      max_tokens: 700,
      system: `${system}\nReply with ONLY the JSON object, no prose, no code fences.`,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Anthropic ${res.status} ${t}`.trim());
  }
  const data = await res.json();
  const text = (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  return parseLlmJson(text);
}

/**
 * Generate { summary, ins } for a person of the given type.
 * Provider via AI_PROVIDER (anthropic|local). Default anthropic for quality; falls back to
 * local automatically when no key is set, so capture never depends on a key being present.
 * Returns { summary:'', ins:'' } if everything fails, so capture never blocks.
 */
export async function synthesize(type, fields) {
  const messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: buildUserMessage(type, fields) },
  ];
  let provider = (process.env.AI_PROVIDER || 'anthropic').toLowerCase();
  if (provider === 'anthropic' && !process.env.ANTHROPIC_API_KEY) {
    console.warn('[ai] anthropic selected but no ANTHROPIC_API_KEY — using local');
    provider = 'local';
  }

  // Try the chosen provider; on any failure, fall back to the other one.
  const order = provider === 'anthropic' ? ['anthropic', 'local'] : ['local', 'anthropic'];
  for (const p of order) {
    if (p === 'anthropic' && !process.env.ANTHROPIC_API_KEY) continue;
    try {
      const parsed = p === 'anthropic' ? await synthesizeAnthropic(messages) : await synthesizeLocal(messages);
      if (parsed && (parsed.summary || parsed.ins)) {
        console.log(`[ai] synthesized via ${p}`);
        return { summary: String(parsed.summary || '').trim(), ins: String(parsed.ins || '').trim() };
      }
    } catch (err) {
      console.warn(`[ai] ${p} failed: ${err.message}`);
    }
  }

  console.error('[ai] all providers failed; returning empty notes');
  return { summary: '', ins: '' };
}
