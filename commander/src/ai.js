// The summarizer. Reuses meddic/src/draft.js's provider pattern: default to the LOCAL qwen3 model
// (with a fallback endpoint), and treat Claude as OPT-IN ONLY. Per the standing suite rule, we NEVER
// call the Claude API unless AI_PROVIDER is explicitly 'anthropic' AND a key is set — leaving
// ANTHROPIC_API_KEY blank hard-disables it. Every generator degrades gracefully: if no model answers,
// it returns null and the caller stores nothing rather than crashing the pipeline.

// qwen3 emits chain-of-thought inside <think>…</think>; strip it (and any stray/unclosed tag) so only
// the answer is stored. Paired with the "/no_think" directive below, which tells qwen3 to skip it.
const stripThink = (t) =>
  String(t)
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/?think>/gi, '')
    .trim();

async function callLocal({ system, user, maxTokens = 400 }) {
  const body = {
    model: process.env.LOCAL_LLM_MODEL || undefined,
    messages: [
      { role: 'system', content: `${system}\n/no_think` },
      { role: 'user', content: user },
    ],
    temperature: 0.3,
    max_tokens: maxTokens,
  };
  const endpoints = [process.env.LOCAL_LLM_URL, process.env.LOCAL_LLM_FALLBACK_URL].filter(Boolean);
  let lastErr;
  for (const url of endpoints) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 60000);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!res.ok) throw new Error(`LLM ${res.status}`);
      const data = await res.json();
      const text = stripThink(data?.choices?.[0]?.message?.content || '');
      if (text) return text;
      throw new Error('empty completion');
    } catch (err) {
      lastErr = err;
      console.warn(`[ai] local ${url} failed: ${err.message}`);
    }
  }
  throw lastErr || new Error('no local endpoint configured');
}

async function callAnthropic({ system, user, maxTokens = 400 }) {
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
      max_tokens: maxTokens,
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

// Route to the configured provider. Defaults to local; only reaches Claude when explicitly selected
// AND keyed. Returns { text, provider } or throws.
async function complete(messages) {
  let chosen = (process.env.AI_PROVIDER || 'local').toLowerCase();
  if (chosen === 'anthropic' && !process.env.ANTHROPIC_API_KEY) {
    console.warn('[ai] anthropic selected but no ANTHROPIC_API_KEY — falling back to local');
    chosen = 'local';
  }
  const text = chosen === 'anthropic' ? await callAnthropic(messages) : await callLocal(messages);
  return { text, provider: chosen };
}

// Best-effort wrapper: never throws, returns null on failure so the pipeline continues.
async function tryComplete(messages) {
  try {
    return await complete(messages);
  } catch (err) {
    console.warn('[ai] generation failed:', err.message);
    return null;
  }
}

// A 1–2 sentence "Today's summary:" line over the most recent items in one feed. `seed` is optional
// grounding text (e.g. a pasted Bloomberg/Morningstar blurb for a financial feed).
export async function summarizeFeed({ company, kind, items, seed }) {
  if (!items?.length) return null;
  const list = items
    .slice(0, 12)
    .map((it, i) => `${i + 1}. ${it.title}${it.published_at ? ` (${String(it.published_at).slice(0, 10)})` : ''}${it.summary ? ` — ${it.summary}` : ''}`)
    .join('\n');
  const system = `You brief a job-seeker targeting ${company}. Given the latest ${kind} items, write ONE tight sentence (two max) capturing the single most important, most recent development — the thing worth knowing at a glance. No preamble, no "here is", no bullet points, no markdown. Just the sentence.`;
  const user = `${seed ? `Background grounding (may help interpret the items):\n${seed}\n\n` : ''}Latest ${kind} for ${company}:\n${list}`;
  const r = await tryComplete({ system, user, maxTokens: 160 });
  return r ? { summary: r.text.replace(/^["']|["']$/g, '').trim(), provider: r.provider } : null;
}

// The SITREP narrative: synthesize the read-only cross-app facts into 2–4 sentences of "where things
// stand + where to push next". Not a re-chart — a briefing. `facts` is the object from rollup.js.
export async function writeSitrep({ scope, facts }) {
  const label = scope === 'all' ? 'the whole campaign across all target companies' : scope;
  const system = `You are the "Commander" — a strategic briefer for Doug's job search at AI companies. Given the current internal state (contacts, outreach, opportunities, open roles), write a crisp SITREP for ${label}: 2–4 sentences, plain prose, no markdown, no headings. Say where things stand and the single highest-leverage next action. Be concrete and specific to the numbers; never invent facts not in the data.`;
  const user = `Current state (JSON):\n${JSON.stringify(facts, null, 2)}`;
  const r = await tryComplete({ system, user, maxTokens: 320 });
  return r ? { narrative: r.text.trim(), provider: r.provider } : null;
}
