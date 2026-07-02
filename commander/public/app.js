// commander SPA — vanilla JS. Company-intelligence dashboard: per-company separated feeds (news /
// blog / events / financials, each with an AI "Today's summary" line), curated intel, and an
// AI SITREP that synthesizes the other apps' data. Hash-routed: #/ = dashboard, #/company/<key>.
const $ = (id) => document.getElementById(id);

// --- Theme + cross-app links (shared chrome) ---
(function initChrome() {
  const host = location.hostname;
  const set = (id, port) => { const a = $(id); if (a) a.href = `${location.protocol}//${host}:${port}/`; };
  set('link-sniper', 7700); set('link-medic', 7701); set('link-engineer', 7702); set('link-specops', 7703); set('link-uav', 7704);
  const btn = $('theme-toggle');
  const sync = () => { btn.textContent = document.documentElement.getAttribute('data-theme') === 'light' ? '☀️' : '🌙'; };
  if (btn) {
    sync();
    btn.onclick = () => {
      const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('theme', next);
      sync();
    };
  }
})();

const api = (path, opts) => fetch(path, opts).then(async (r) => {
  const body = r.headers.get('content-type')?.includes('json') ? await r.json() : null;
  if (!r.ok) throw new Error(body?.error || `HTTP ${r.status}`);
  return body;
});
const esc = (s) => (s == null ? '' : String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));
const jsonPost = (path, obj) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: obj ? JSON.stringify(obj) : undefined });
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), 2600);
}

const KIND_LABEL = { news: 'News', blog: 'Blog', event: 'Events', financial: 'Financials', research: 'Research', general: 'Other' };
const KIND_ORDER = ['news', 'blog', 'event', 'financial', 'research', 'general'];
// Column title: a per-company override from the source config wins (OpenAI's news kind = "Company").
const kindLabel = (src, k) => src?.kindLabels?.[k] || KIND_LABEL[k];
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');
const fmtWhen = (d) => (d ? `updated ${new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : '');
const app = () => $('app');

// Company logo captured by Sniper (media/company-icons/<id>.png, served via the shared /media mount).
const companyLogo = (id, cls = 'co-logo') =>
  (id ? `<img class="${cls}" src="/media/company-icons/${id}.png" alt="" onerror="this.style.display='none'">` : '');

// Deterministic action flags (from rollup.js) rendered as chips — the card shows what to DO, not a recap.
function actionsHTML(actions, max = 3) {
  if (!actions?.length) return `<div class="act-clear">✓ Nothing urgent</div>`;
  return actions.slice(0, max).map((a) =>
    `<div class="act act-${esc(a.severity)}" title="${esc(a.severity)}">${esc(a.text)}</div>`
  ).join('') + (actions.length > max ? `<div class="act-more">+${actions.length - max} more</div>` : '');
}

// --- SITREP block (shared by dashboard + company view) ---
function sitrepHTML(sitrep, { scope, label }) {
  // The model emits one action per line; render each as a bullet. Older single-paragraph rows are
  // split on sentence boundaries so they bullet too.
  let body = `<div class="sitrep-body">No SITREP yet — click <strong>Brief me</strong> to generate one.</div>`;
  if (sitrep?.narrative) {
    let lines = sitrep.narrative.split('\n').map((l) => l.replace(/^[-•*\d.)\s]+/, '').trim()).filter(Boolean);
    if (lines.length === 1) lines = lines[0].split(/(?<=[.!?])\s+(?=[A-Z🎯])/).filter(Boolean);
    body = `<ul class="sitrep-list">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`;
  }
  return `<div class="sitrep ${sitrep?.narrative ? '' : 'pending'}">
    <div class="sitrep-head">
      <span class="sitrep-title">⭐ SITREP · ${esc(label)}</span>
      <button class="sm" data-sitrep="${esc(scope)}">Brief me ↻</button>
      <span class="sitrep-when">${esc(sitrep?.generated_at ? fmtWhen(sitrep.generated_at) : '')}</span>
    </div>${body}</div>`;
}

// ======================= DASHBOARD =======================
async function renderDashboard() {
  app().innerHTML = `<div class="empty">Loading intelligence…</div>`;
  let data;
  try { data = await api('/api/companies'); } catch (e) { app().innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }

  const cards = data.companies.map((c) => {
    const feeds = KIND_ORDER.filter((k) => c.kinds.includes(k)).map((k) => {
      const items = c.headlines[k] || [];
      const rows = items.length
        ? items.map((h) => `<div class="fh"><span class="fh-date">${esc(fmtDate(h.published_at || h.first_seen_at))}</span><span class="fh-title">${esc(h.title)}</span></div>`).join('')
        : `<div class="fh"><span class="muted">—</span></div>`;
      return `<div class="feedline"><span class="fk ${k}">${esc(kindLabel(c, k))}</span><div class="fh-list">${rows}</div></div>`;
    }).join('');
    const unread = c.counts.unread ? `<span class="badge unread">${c.counts.unread} new</span>` : '';
    return `<div class="ccard" data-key="${esc(c.key)}">
      <div class="ccard-head">
        ${companyLogo(c.company_id)}
        <span class="ccard-name">${esc(c.label)}</span>
        <span class="ccard-meta"><span class="badge ${c.profile}">${esc(c.profile)}</span>${unread}</span>
      </div>
      <div class="ccard-actions">${actionsHTML(c.actions)}</div>
      <div class="ccard-feeds">${feeds || '<div class="muted sm">No feeds configured</div>'}</div>
    </div>`;
  }).join('');

  app().innerHTML = `
    ${sitrepHTML(data.sitrep, { scope: 'all', label: 'Whole campaign' })}
    <div class="toolbar">
      <button id="refresh-all" class="primary">⟳ Refresh all intelligence</button>
      <span class="spacer"></span>
      <span class="muted sm">${data.companies.length} companies watched</span>
    </div>
    <div class="cards">${cards}</div>`;
}

// ======================= COMPANY VIEW =======================
async function renderCompany(key) {
  app().innerHTML = `<div class="empty">Loading…</div>`;
  let data;
  try { data = await api(`/api/company/${encodeURIComponent(key)}`); } catch (e) { app().innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const s = data.source;
  CURRENT.label = s.label;
  INTEL = new Map((data.intel || []).map((r) => [r.section, r]));
  INTEL_DOCS = data.intelDocs || [];

  const feedCols = KIND_ORDER.filter((k) => data.feeds[k]).map((k) => {
    const f = data.feeds[k];
    const digest = f.digest?.summary
      ? `<div class="feedcol-digest"><span class="dg-label">Today's summary:</span> ${esc(f.digest.summary)}</div>`
      : `<div class="feedcol-digest pending">No AI summary yet.</div>`;
    const items = f.items.length ? f.items.map((it) => itemHTML(it, k)).join('') : `<div class="empty" style="padding:20px">No items yet.</div>`;
    return `<div class="feedcol">
      <div class="feedcol-head"><div class="feedcol-title">${esc(kindLabel(s, k))}</div>${digest}</div>
      <div class="feedcol-list">${items}</div>
    </div>`;
  }).join('');

  app().innerHTML = `
    <div class="toolbar"><button class="sm" data-nav="#/">← All companies</button></div>
    <div class="co-head">
      ${companyLogo(data.company_id, 'co-logo lg')}
      <span class="co-title">${esc(s.label)}</span>
      <span class="badge ${s.profile}">${esc(s.profile)}</span>
      <div class="co-actions">
        <a class="linkbtn" href="${esc(s.homeUrl)}" target="_blank" rel="noopener">Site ↗</a>
        ${(s.links || []).map((l) => `<a class="linkbtn" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`).join('')}
        ${s.xListUrl ? `<a class="linkbtn" href="${esc(s.xListUrl)}" target="_blank" rel="noopener">X List ↗</a>` : ''}
        <button class="primary" data-refresh="${esc(s.key)}">⟳ Refresh</button>
      </div>
    </div>
    ${sitrepHTML(data.sitrep, { scope: s.label, label: s.label })}
    <div class="co-layout">
      <div><div class="feeds-grid">${feedCols || '<div class="empty">No feeds configured.</div>'}</div></div>
      <aside class="intel">${intelHTML(s.label, data.intel, data.intelDocs)}</aside>
    </div>`;
}

function itemHTML(it, kind) {
  const date = it.event_start ? fmtDate(it.event_start) : fmtDate(it.published_at);
  const loc = it.event_location ? `<div class="fi-loc">📍 ${esc(it.event_location)}</div>` : '';
  const sum = it.ai_summary || it.summary;
  return `<div class="fitem ${it.is_read ? '' : 'unread'}" data-item="${it.id}">
    ${date ? `<div class="fi-date">${esc(date)}</div>` : ''}
    <div class="fi-title">${it.url ? `<a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)} ↗</a>` : esc(it.title)}</div>
    ${loc}
    ${sum ? `<div class="fi-sum">${esc(sum)}</div>` : ''}
  </div>`;
}

// --- mini-markdown renderer (escape-FIRST, so it's injection-safe; no external lib) ---
// Supports: # ## ### headings, **bold**, *italic*, `code`, [text](https://url), "- " bullet lists,
// paragraphs/line breaks. Enough for notes/intel; anything else renders as literal text.
function md(src) {
  let h = esc(src);
  h = h.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  h = h.replace(/^###\s+(.+)$/gm, '<h5>$1</h5>')
       .replace(/^##\s+(.+)$/gm, '<h4>$1</h4>')
       .replace(/^#\s+(.+)$/gm, '<h4>$1</h4>');
  h = h.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
       .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
  // links: href comes from already-escaped text and must look like http(s); quotes are escaped so it
  // can't break out of the attribute.
  h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a class="link" href="$2" target="_blank" rel="noopener">$1</a>');
  // consecutive "- " lines → one <ul>
  h = h.replace(/(^|\n)((?:- [^\n]*(?:\n|$))+)/g, (m, pre, block) =>
    `${pre}<ul>${block.trim().split('\n').map((l) => `<li>${l.replace(/^- /, '')}</li>`).join('')}</ul>`);
  // remaining newlines → <br>, except right after block elements
  h = h.replace(/(<\/(?:h4|h5|ul)>)\n/g, '$1').replace(/\n/g, '<br>');
  return h;
}

// Raw intel rows for the company being viewed (section → {title, body, source_url}), kept so the
// editor prefills SOURCE text — the rendered markdown in the DOM is not editable state.
let INTEL = new Map();
let INTEL_DOCS = [];

// Intel panel. NO collapse/expand anywhere: a section with content (link and/or note) shows it; an
// empty section is just its header row ("appears collapsed"). The link renders as a full-width
// link row — icon + hostname + arrow, a real click target. 'notes' is always present, always first.
function intelHTML(company, intel, docs) {
  const bySection = new Map(intel.map((r) => [r.section, r]));
  const order = ['notes']; // Doug's own notes — always present, always first
  for (const d of docs || []) if (!order.includes(d.section)) order.push(d.section);
  for (const r of intel) if (!order.includes(r.section)) order.push(r.section);
  const docFor = (sec) => (docs || []).find((d) => d.section === sec);

  const secs = order.map((sec) => {
    const row = bySection.get(sec);
    const doc = docFor(sec);
    const title = row?.title || doc?.title || sec.replace(/_/g, ' ');
    const src = row?.source_url || doc?.url;

    const parts = [];
    if (src) {
      parts.push(`<a class="intel-link-row" href="${esc(src)}" target="_blank" rel="noopener" title="${esc(src)}">
        <span class="ilr-ico">🔗</span><span class="ilr-host">${esc(linkHost(src))}</span><span class="spacer"></span><span class="ilr-arrow">↗</span>
      </a>`);
    }
    if (row?.body?.trim()) parts.push(`<div class="md">${md(row.body)}</div>`);
    const body = parts.length ? `<div class="intel-sec-body">${parts.join('')}</div>` : '';

    return `<div class="intel-sec ${sec === 'notes' ? 'pinned' : ''}" data-section="${esc(sec)}">
      <div class="intel-sec-head"><span class="intel-sec-name">${esc(title)}</span><span class="spacer"></span>
        <button class="sm ghost" data-edit-intel="${esc(sec)}">Edit</button>
      </div>${body}</div>`;
  }).join('');

  return `<h3>Intel — ${esc(company)}</h3>${secs || '<div class="intel-empty">No intel sections yet.</div>'}
    <button class="sm ghost" data-add-intel="1" style="margin-top:6px">+ Add section</button>`;
}

// Short display form of a URL for the notes link chip.
function linkHost(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'link'; }
}

// ======================= actions =======================
async function doRefresh(btn, companyKey) {
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = '⟳ Refreshing…';
  try {
    const q = companyKey ? `?company=${encodeURIComponent(companyKey)}` : '';
    const r = await jsonPost(`/api/refresh${q}`);
    toast(`${r.added} new item(s)${r.errors?.length ? `, ${r.errors.length} feed error(s)` : ''}`);
    route();
  } catch (e) {
    toast(e.message); btn.disabled = false; btn.textContent = label;
  }
}

async function doSitrep(scope, btn) {
  const t = btn.textContent; btn.disabled = true; btn.textContent = 'Briefing…';
  try {
    await jsonPost(`/api/sitrep/refresh?scope=${encodeURIComponent(scope)}`);
    toast('SITREP updated'); route();
  } catch (e) { toast(e.message); btn.disabled = false; btn.textContent = t; }
}

// Swap an intel section into its editor: a Link (url) input + a Note (markdown) textarea. Prefills
// from the RAW stored row (INTEL map), never from the rendered markdown in the DOM.
function editIntel(company, sec) {
  const wrap = document.querySelector(`.intel-sec[data-section="${CSS.escape(sec)}"]`);
  if (!wrap) return;
  const row = INTEL.get(sec);
  const doc = INTEL_DOCS.find((d) => d.section === sec);
  const link = row?.source_url ?? doc?.url ?? '';
  const note = row?.body ?? '';
  const title = row?.title || doc?.title || sec.replace(/_/g, ' ');
  let body = wrap.querySelector('.intel-sec-body');
  if (!body) { // empty sections render without a body — add one for the editor
    body = document.createElement('div');
    body.className = 'intel-sec-body';
    wrap.appendChild(body);
  }
  body.innerHTML = `
    <label class="intel-label">Section name</label>
    <input type="text" class="intel-title-edit" placeholder="${esc(sec.replace(/_/g, ' '))}" value="${esc(title)}">
    <label class="intel-label">Link</label>
    <input type="url" class="intel-link-edit" placeholder="https://…" value="${esc(link)}">
    <label class="intel-label">Notes <span class="muted sm">(via Markdown)</span></label>
    <textarea class="intel-edit" placeholder="Write a note…">${esc(note)}</textarea>
    <div style="margin-top:8px;display:flex;gap:8px"><button class="sm primary" data-save-intel="${esc(sec)}">Save</button>
    <button class="sm ghost" data-cancel-intel="1">Cancel</button>
    <span class="spacer"></span>
    ${row ? `<button class="sm ghost danger" data-delete-intel="${esc(sec)}">${sec === 'notes' ? 'Clear' : 'Delete'}</button>` : ''}</div>`;
  body.querySelector('textarea').focus();
}

// Remove a section's stored row. Custom sections vanish; notes/seeded sections revert to empty.
async function deleteIntel(company, sec) {
  const label = sec === 'notes' ? 'Clear the note (and its link)?' : `Delete the "${sec.replace(/_/g, ' ')}" section?`;
  if (!confirm(label)) return;
  try {
    await api(`/api/intel/${encodeURIComponent(company)}/${encodeURIComponent(sec)}`, { method: 'DELETE' });
    toast(sec === 'notes' ? 'Notes cleared' : 'Section deleted');
    route();
  } catch (e) { toast(e.message); }
}

async function saveIntel(company, sec) {
  const wrap = document.querySelector(`.intel-sec[data-section="${CSS.escape(sec)}"]`);
  const body = wrap.querySelector('textarea').value;
  const source_url = wrap.querySelector('.intel-link-edit')?.value.trim() || null;
  const title = wrap.querySelector('.intel-title-edit')?.value.trim() || null;
  try {
    await api(`/api/intel/${encodeURIComponent(company)}/${encodeURIComponent(sec)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, source_url, title }),
    });
    toast('Intel saved'); route();
  } catch (e) { toast(e.message); }
}

// --- event delegation ---
document.addEventListener('click', (e) => {
  const card = e.target.closest('.ccard');
  const nav = e.target.closest('[data-nav]');
  const refresh = e.target.closest('[data-refresh]');
  const sitrep = e.target.closest('[data-sitrep]');
  const editIn = e.target.closest('[data-edit-intel]');
  const saveIn = e.target.closest('[data-save-intel]');
  const deleteIn = e.target.closest('[data-delete-intel]');
  const cancelIn = e.target.closest('[data-cancel-intel]');
  const addIn = e.target.closest('[data-add-intel]');
  const item = e.target.closest('.fitem');

  if ($('refresh-all') && e.target === $('refresh-all')) return doRefresh($('refresh-all'), null);
  if (refresh) return doRefresh(refresh, refresh.dataset.refresh);
  if (sitrep) return doSitrep(sitrep.dataset.sitrep, sitrep);
  if (nav) { location.hash = nav.dataset.nav; return; }
  if (editIn) { const co = companyLabelFromView(); return editIntel(co, editIn.dataset.editIntel); }
  if (saveIn) { const co = companyLabelFromView(); return saveIntel(co, saveIn.dataset.saveIntel); }
  if (deleteIn) { const co = companyLabelFromView(); return deleteIntel(co, deleteIn.dataset.deleteIntel); }
  if (cancelIn) return route();
  if (addIn) {
    const name = prompt('Section name (e.g. mission, values, policy, interview_guide, notes):');
    if (name) editIntelNew(companyLabelFromView(), name.trim().toLowerCase().replace(/\s+/g, '_'));
    return;
  }
  if (item && item.classList.contains('unread')) {
    jsonPost(`/api/feed/${item.dataset.item}/read`, { read: true }).then(() => item.classList.remove('unread')).catch(() => {});
  }
  if (card && !e.target.closest('a')) { location.hash = `#/company/${card.dataset.key}`; }
});

// The company label of the current #/company/<key> view (intel edits are keyed by label).
let CURRENT = { label: null };
const companyLabelFromView = () => CURRENT.label;

function editIntelNew(company, sec) {
  // Ensure a placeholder section exists, then open it for editing.
  const aside = document.querySelector('.intel');
  if (aside && !document.querySelector(`.intel-sec[data-section="${CSS.escape(sec)}"]`)) {
    const div = document.createElement('div');
    div.className = 'intel-sec'; div.dataset.section = sec;
    div.innerHTML = `<div class="intel-sec-head"><span class="intel-sec-name">${esc(sec.replace(/_/g, ' '))}</span><span class="spacer"></span><button class="sm ghost" data-edit-intel="${esc(sec)}">Edit</button></div>`;
    aside.insertBefore(div, aside.querySelector('[data-add-intel]'));
  }
  editIntel(company, sec);
}

// ======================= routing =======================
async function route() {
  const m = location.hash.match(/^#\/company\/(.+)$/);
  if (m) { await renderCompany(decodeURIComponent(m[1])); }
  else { CURRENT.label = null; await renderDashboard(); }
}

window.addEventListener('hashchange', route);
route();
