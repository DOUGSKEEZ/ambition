// Drafting layer — the accuracy engine. Assembles a context package (the editable
// prompt sections + Doug's voice + the target's Sniper enrichment + the step's
// purpose/skeleton/goal) and calls the configured provider. The prompt itself lives
// in prompt.js (defaults) + the prompt_overrides table (edits from the UI modal).
// Provider is a config swap, not a code change.
import { assembleSystemPrompt, buildUserPrompt, loadPromptOverrides } from './prompt.js';

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
  const overrides = await loadPromptOverrides();
  const messages = {
    system: assembleSystemPrompt(overrides),
    user: buildUserPrompt({ person, step, goal }),
  };

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
