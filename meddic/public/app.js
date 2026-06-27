// meddic SPA — vanilla JS, same-origin fetch.
const $ = (id) => document.getElementById(id);

// --- Theme + cross-app link (shared pattern with sniper) ---
(function initChrome() {
  const link = document.getElementById('cross-link');
  if (link) link.href = `${location.protocol}//${location.hostname}:7700/`; // -> sniper
  const uav = document.getElementById('link-uav');
  if (uav) uav.href = `${location.protocol}//${location.hostname}:7704/`; // -> uav
  const btn = document.getElementById('theme-toggle');
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

let companies = [];
let campaigns = [];
let companyId = null;
let person = null;       // current person detail
let editingCampaign = null;

function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), 2600);
}
let currentView = 'today';
function show(view) {
  currentView = view;
  for (const v of ['today', 'tomorrow', 'roster', 'person', 'campaigns', 'campaign-edit']) {
    $(`view-${v}`).classList.toggle('hidden', v !== view);
  }
  $('tab-today').classList.toggle('active', view === 'today');
  $('tab-tomorrow').classList.toggle('active', view === 'tomorrow');
  $('tab-roster').classList.toggle('active', view === 'roster');
  $('tab-campaigns').classList.toggle('active', view === 'campaigns' || view === 'campaign-edit');
  fitAll(); // textareas can't measure scrollHeight while hidden — fit once the view is visible
}
// Reload whichever list view is currently showing (used by the global company picker).
function reloadCurrent() {
  if (currentView === 'today') loadToday();
  else if (currentView === 'tomorrow') loadWeek();
  else if (currentView === 'roster') loadRoster();
  else if (currentView === 'campaigns') loadCampaigns();
}

// Grow a textarea to fit its content (capped, then it scrolls). Manual resize still works;
// it just re-fits on the next keystroke.
function autosize(el) {
  if (!el || el.tagName !== 'TEXTAREA') return;
  el.style.height = 'auto';
  // Prompt-editor textareas grow to fit all their text (the modal scrolls, not the box).
  const cap = el.classList.contains('pm-body') ? Infinity : 600;
  el.style.height = Math.min(el.scrollHeight + 2, cap) + 'px';
}
function fitAll() {
  requestAnimationFrame(() => document.querySelectorAll('textarea').forEach(autosize));
}
// Auto-fit any textarea as the user types or pastes (delegated, covers dynamic step editors).
document.addEventListener('input', (e) => { if (e.target.tagName === 'TEXTAREA') autosize(e.target); });
function photoUrl(p) {
  return p && p.photo_path ? `/media/${p.photo_path}`
    : 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36"><rect width="36" height="36" fill="%231f2430"/></svg>');
}
function heatBadge(h) { return h ? `<span class="badge ${h}">${h}</span>` : ''; }
// ✅ when the contact's next outreach is prepared and ready to send (Tracker "ready/staged").
function stagedIcon(s) { return s ? '<span class="staged-icon" title="Ready / staged — next outreach prepared">✅</span>' : ''; }
function typeBadge(t) { return t ? `<span class="badge ${t}">${t.replace('_', ' ')}</span>` : ''; }

// Canonical outreach channels for campaign steps. `value` is what's stored; each maps to
// a small SVG in /icons. Order = dropdown order. Legacy/freeform channel strings outside
// this set still render (as their raw text) and are preserved when editing.
const CHANNELS = [
  { value: 'email',      label: 'Email',      icon: 'icons/ch-email.svg' },
  { value: 'linkedin',   label: 'LinkedIn',   icon: 'icons/ch-linkedin.svg' },
  { value: 'call',       label: 'Call',       icon: 'icons/ch-call.svg' },
  { value: 'text',       label: 'Text',       icon: 'icons/ch-text.svg' },
  { value: 'voice_memo', label: 'Voice Memo', icon: 'icons/ch-voice-memo.svg' },
  { value: 'video_memo', label: 'Video Memo', icon: 'icons/ch-video-memo.svg' },
];
const CHANNEL_BY = Object.fromEntries(CHANNELS.map((c) => [c.value, c]));

// Read-only channel marker for the queue/roster lists: the icon for a known channel,
// or the bracketed raw text for a legacy/unknown value ('' when blank).
function channelTag(value) {
  const c = CHANNEL_BY[value];
  if (c) return `<img class="ch-ico" src="${c.icon}" title="${c.label}" alt="${c.label}">`;
  return value ? `[${esc(value)}]` : '';
}

// Editor widget: a live preview icon + a <select data-f="channel">. Returns HTML; call
// wireChannels(rootEl) after inserting it so the icon tracks the selection.
function channelField(value) {
  const known = CHANNEL_BY[value];
  const opts = CHANNELS.map((c) => `<option value="${c.value}"${c.value === value ? ' selected' : ''}>${c.label}</option>`);
  if (value && !known) opts.unshift(`<option value="${esc(value)}" selected>${esc(value)}</option>`);
  return `<span class="ch-field">
    <img class="ch-ico ch-preview" src="${known ? known.icon : ''}" alt="">
    <select data-f="channel" class="ch-select">${opts.join('')}</select>
  </span>`;
}
function wireChannels(root) {
  root.querySelectorAll('.ch-field').forEach((field) => {
    const sel = field.querySelector('.ch-select');
    const img = field.querySelector('.ch-preview');
    const sync = () => {
      const c = CHANNEL_BY[sel.value];
      img.src = c ? c.icon : '';
      img.style.visibility = c ? 'visible' : 'hidden';
    };
    sel.addEventListener('change', sync);
    sync();
  });
}

// Inline label/nickname editor for the roster + today tables. Returns a chip; clicking
// it swaps in an input that PUTs the label on Enter/blur (Escape cancels). Empty labels
// show a faint "+ label" affordance that appears on row hover.
function makeNick(id, value) {
  const span = document.createElement('span');
  span.className = value ? 'nick' : 'nick add';
  span.textContent = value || '+ label';
  span.title = 'Click to edit label';
  span.onclick = (e) => { e.stopPropagation(); editNick(span, id, value); };
  return span;
}
function editNick(span, id, value) {
  const input = document.createElement('input');
  input.className = 'nick-input';
  input.value = value;
  input.maxLength = 60;
  input.placeholder = 'label…';
  input.onclick = (e) => e.stopPropagation();
  let done = false;
  const finish = async (commit) => {
    if (done) return; done = true;
    const next = input.value.trim();
    if (commit && next !== value) {
      try { await api(`/people/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: next || null }) }); toast('Label saved'); }
      catch (err) { toast(err.message); return input.replaceWith(makeNick(id, value)); }
      return input.replaceWith(makeNick(id, next));
    }
    input.replaceWith(makeNick(id, value));
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  };
  input.onblur = () => finish(true);
  span.replaceWith(input);
  input.focus();
  input.select();
}

// Inline emoji "marker" editor — the freeform replacement for the old 0–100 priority.
// Mirrors makeNick: a chip you click to swap in an input that PUTs `emoji` on Enter/blur.
function makeEmoji(id, value) {
  const span = document.createElement('span');
  span.className = value ? 'emoji-chip' : 'emoji-chip add';
  span.textContent = value || '＋';
  span.title = 'Click to set an emoji marker (urgency, vibe, anything)';
  span.onclick = (e) => { e.stopPropagation(); editEmoji(span, id, value); };
  return span;
}
function editEmoji(span, id, value) {
  const input = document.createElement('input');
  input.className = 'emoji-input';
  input.value = value;
  input.maxLength = 20; // a handful of emoji incl. ZWJ/flag sequences (UTF-16 units)
  input.placeholder = '🔥';
  input.onclick = (e) => e.stopPropagation();
  let done = false;
  const finish = async (commit) => {
    if (done) return; done = true;
    const next = input.value.trim();
    if (commit && next !== value) {
      try { await api(`/people/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ emoji: next || null }) }); toast('Marker saved'); }
      catch (err) { toast(err.message); return input.replaceWith(makeEmoji(id, value)); }
      return input.replaceWith(makeEmoji(id, next));
    }
    input.replaceWith(makeEmoji(id, value));
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  };
  // Commit only when focus moves to a real element (tabbing/clicking another field).
  // The OS emoji picker — and app/window switches — blur with a null relatedTarget;
  // keep the editor open in that case so the picked emoji lands in it. Press Enter to save.
  input.onblur = (e) => { if (e.relatedTarget) finish(true); };
  span.replaceWith(input);
  input.focus();
  input.select();
}

// Format a date (or ISO timestamp) as "Jun 01". Returns '' for blank.
function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d.length <= 10 ? `${d}T00:00:00` : d);
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
}

// Today's date as YYYY-MM-DD in the user's local timezone (not UTC — toISOString would
// roll over a day near midnight). Matches the <input type="date"> value format.
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Query-string fragment for the global company filter, '' when "All companies" is active
// (the backend list endpoints omit the filter and return every company in that case).
function companyQS() { return companyId === 'all' ? '' : `company_id=${companyId}`; }
// Build "/path?a&b" from a base and query fragments, dropping empties. Keeps call sites
// readable now that the company filter can be blank.
function withQS(base, ...frags) {
  const q = frags.filter(Boolean).join('&');
  return q ? `${base}?${q}` : base;
}

// ---------- bootstrap ----------
async function loadCompanies() {
  companies = await api('/companies');
  const sel = $('company');
  sel.innerHTML = '';
  if (!companies.length) { sel.innerHTML = '<option value="">(no companies)</option>'; return; }
  // "All companies" (value 'all') shows every company's contacts in one list; the list
  // views reveal a Company column when it's active. Default stays the first company A–Z.
  const all = document.createElement('option');
  all.value = 'all'; all.textContent = 'All companies';
  sel.appendChild(all);
  for (const c of companies) {
    const o = document.createElement('option');
    o.value = c.id; o.textContent = `${c.name} (${c.active_contacts})`;
    sel.appendChild(o);
  }
  companyId = companies[0].id;
  sel.value = companyId;
}
async function loadCampaignList() { campaigns = await api('/campaigns'); }

// ---------- Today ----------
// Click a column header to sort by it; click the active one again to flip direction.
// Default: no client sort — keep the server's order (heat, then due date).
let todaySort = { by: null, dir: 'asc' };
const TODAY_SORT_VALUE = {
  marker: (r) => r.emoji || null,
  name: (r) => (r.name || '').toLowerCase() || null,
  company: (r) => (r.company_name || '').toLowerCase() || null,
  type: (r) => r.type || null,
  campaign: (r) => (r.campaign_name || '').toLowerCase() || null,
  next_step: (r) => (r.next_step_purpose || '').toLowerCase() || null,
  label: (r) => (r.label || '').toLowerCase() || null,
  due: (r) => (r.next_action_date ? r.next_action_date.slice(0, 10) : null),
};

// Reorder rows in place by the active column. Missing values always sink to the
// bottom regardless of direction (no value = nothing to surface).
function sortToday(rows) {
  const getVal = TODAY_SORT_VALUE[todaySort.by];
  if (!getVal) return;
  const sign = todaySort.dir === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    const va = getVal(a), vb = getVal(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return sign * (va < vb ? -1 : va > vb ? 1 : 0);
  });
}

function setTodaySort(by) {
  if (todaySort.by === by) todaySort.dir = todaySort.dir === 'asc' ? 'desc' : 'asc';
  else todaySort = { by, dir: 'asc' };
  loadToday();
}

function updateTodaySortArrows() {
  document.querySelectorAll('#today-table th.sortable').forEach((th) => {
    const active = th.dataset.sort === todaySort.by;
    th.classList.toggle('active', active);
    th.querySelector('.arrow').textContent = active ? (todaySort.dir === 'asc' ? ' ▲' : ' ▼') : '';
  });
}

async function loadToday() {
  if (!companyId) return;
  const showCompany = companyId === 'all';
  $('today-table').classList.toggle('show-company', showCompany);
  let rows = await api(withQS('/queue', companyQS()));
  const type = $('today-type').value;
  if (type) rows = rows.filter((r) => r.type === type);
  sortToday(rows);
  updateTodaySortArrows();
  const body = $('today-body'); body.innerHTML = '';
  $('today-empty').classList.toggle('hidden', rows.length > 0);
  const cooling = rows.filter((r) => r.going_cold).length;
  $('today-note').textContent = `${rows.length} due${cooling ? ` · ${cooling} going cold` : ''}`;
  for (const r of rows) {
    const tr = document.createElement('tr');
    const next = r.next_step_purpose ? `${channelTag(r.next_step_channel)} ${esc(r.next_step_purpose)}` : '<span class="muted">— no steps —</span>';
    tr.innerHTML = `
      <td><img class="thumb" src="${photoUrl(r)}"></td>
      <td class="emoji-cell"></td>
      <td class="name-cell">${esc(r.name)} ${stagedIcon(r.staged)} ${heatBadge(r.hot_cold)} ${r.going_cold ? '<span class="badge cooling">cooling</span>' : ''}</td>
      <td class="company-col">${esc(r.company_name) || ''}</td>
      <td>${typeBadge(r.type)}</td>
      <td>${esc(r.campaign_name) || '<span class="muted">unassigned</span>'}</td>
      <td>${next}</td>
      <td class="label-cell"></td>
      <td class="na-cell"></td>`;
    tr.onclick = (e) => { if (!e.target.closest('.nick, .nick-input, .na-input, .emoji-chip, .emoji-input')) openPerson(r.id); };
    tr.querySelector('.emoji-cell').appendChild(makeEmoji(r.id, r.emoji || ''));
    tr.querySelector('.label-cell').appendChild(makeNick(r.id, r.label || ''));
    tr.querySelector('.na-cell').appendChild(makeNextAction(r, loadToday));
    body.appendChild(tr);
  }
  loadDone().catch((e) => toast(e.message));
}

// Recap of outreach already done today: one row per step sent today (newest first).
async function loadDone() {
  if (!companyId) return;
  $('done-table').classList.toggle('show-company', companyId === 'all');
  const rows = await api(withQS('/queue/done', companyQS()));
  const body = $('done-body'); body.innerHTML = '';
  $('done-empty').classList.toggle('hidden', rows.length > 0);
  $('done-note').textContent = rows.length ? `${rows.length} sent today` : '';
  for (const r of rows) {
    const tr = document.createElement('tr');
    const step = r.purpose ? `${channelTag(r.channel)} ${esc(r.purpose)}` : `<span class="muted">step ${r.step_order}</span>`;
    tr.innerHTML = `
      <td><img class="thumb" src="${photoUrl(r)}"></td>
      <td>${esc(r.name)}</td>
      <td class="company-col">${esc(r.company_name) || ''}</td>
      <td>${typeBadge(r.type)}</td>
      <td>${esc(r.campaign_name) || '<span class="muted">bespoke</span>'}</td>
      <td>${step}</td>
      <td class="label-cell"></td>
      <td class="na-cell"></td>`;
    tr.onclick = (e) => { if (!e.target.closest('.nick, .nick-input, .na-input')) openPerson(r.id); };
    tr.querySelector('.label-cell').appendChild(makeNick(r.id, r.label || ''));
    tr.querySelector('.na-cell').appendChild(makeNextAction(r, loadToday));
    body.appendChild(tr);
  }
}

// ---------- Tomorrow (rest of the work week) ----------
// Same click-to-sort behavior as the Today queue; default keeps the server's order.
let tomorrowSort = { by: null, dir: 'asc' };
const TOMORROW_SORT_VALUE = {
  marker: (r) => r.emoji || null,
  name: (r) => (r.name || '').toLowerCase() || null,
  company: (r) => (r.company_name || '').toLowerCase() || null,
  type: (r) => r.type || null,
  campaign: (r) => (r.campaign_name || '').toLowerCase() || null,
  next_step: (r) => (r.next_step_purpose || '').toLowerCase() || null,
  heat: (r) => r.hot_cold || null,
  na: (r) => (r.next_action_date ? r.next_action_date.slice(0, 10) : null),
};

// Reorder rows in place by the active column. Missing values always sink to the bottom.
function sortTomorrow(rows) {
  const getVal = TOMORROW_SORT_VALUE[tomorrowSort.by];
  if (!getVal) return;
  const sign = tomorrowSort.dir === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    const va = getVal(a), vb = getVal(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return sign * (va < vb ? -1 : va > vb ? 1 : 0);
  });
}

function setTomorrowSort(by) {
  if (tomorrowSort.by === by) tomorrowSort.dir = tomorrowSort.dir === 'asc' ? 'desc' : 'asc';
  else tomorrowSort = { by, dir: 'asc' };
  loadWeek();
}

function updateTomorrowSortArrows() {
  document.querySelectorAll('#tomorrow-table th.sortable').forEach((th) => {
    const active = th.dataset.sort === tomorrowSort.by;
    th.classList.toggle('active', active);
    th.querySelector('.arrow').textContent = active ? (tomorrowSort.dir === 'asc' ? ' ▲' : ' ▼') : '';
  });
}

async function loadWeek() {
  if (!companyId) return;
  $('tomorrow-table').classList.toggle('show-company', companyId === 'all');
  const { start, end, rows } = await api(withQS('/queue/week', companyQS()));
  const type = $('tomorrow-type').value;
  const list = type ? rows.filter((r) => r.type === type) : rows;
  sortTomorrow(list);
  updateTomorrowSortArrows();
  const body = $('tomorrow-body'); body.innerHTML = '';
  $('tomorrow-empty').classList.toggle('hidden', list.length > 0);
  $('tomorrow-note').textContent = `${list.length} planned · ${fmtDate(start)}–${fmtDate(end)}`;
  for (const r of list) {
    const tr = document.createElement('tr');
    const next = r.next_step_purpose ? `${channelTag(r.next_step_channel)} ${esc(r.next_step_purpose)}` : '<span class="muted">— no steps —</span>';
    tr.innerHTML = `
      <td><img class="thumb" src="${photoUrl(r)}"></td>
      <td class="emoji-cell"></td>
      <td class="name-cell">${esc(r.name)} ${stagedIcon(r.staged)}</td>
      <td class="company-col">${esc(r.company_name) || ''}</td>
      <td>${typeBadge(r.type)}</td>
      <td>${esc(r.campaign_name) || '<span class="muted">unassigned</span>'}</td>
      <td>${next}</td>
      <td>${heatBadge(r.hot_cold)}</td>
      <td class="na-cell"></td>`;
    tr.onclick = (e) => { if (!e.target.closest('.nick, .nick-input, .na-input, .emoji-chip, .emoji-input')) openPerson(r.id); };
    tr.querySelector('.name-cell').appendChild(makeNick(r.id, r.label || ''));
    tr.querySelector('.emoji-cell').appendChild(makeEmoji(r.id, r.emoji || ''));
    tr.querySelector('.na-cell').appendChild(makeNextAction(r));
    body.appendChild(tr);
  }
}

// Inline date editor for a contact's next action. Saving may move the contact out of the
// week window (or into the past = onto Today), so we reload (reloadFn) to re-filter.
function makeNextAction(r, reloadFn = loadWeek) {
  const input = document.createElement('input');
  input.type = 'date';
  input.className = 'na-input';
  input.value = r.next_action_date ? r.next_action_date.slice(0, 10) : '';
  input.onclick = (e) => e.stopPropagation();
  input.onchange = async () => {
    try {
      await api(`/people/${r.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ next_action_date: input.value || null }),
      });
      toast('Next action updated');
      reloadFn();
    } catch (e) { toast(e.message); input.value = r.next_action_date ? r.next_action_date.slice(0, 10) : ''; }
  };
  return input;
}

// ---------- Roster ----------
// Click a column header to sort by it; click the active one again to flip direction.
// Default: no client sort — keep the server's order (heat, then name).
let rosterSort = { by: null, dir: 'asc' };
const SORT_VALUE = {
  marker: (r) => r.emoji || null,
  name: (r) => (r.name || '').toLowerCase() || null,
  company: (r) => (r.company_name || '').toLowerCase() || null,
  type: (r) => r.type || null,
  title: (r) => (r.title || '').toLowerCase() || null,
  campaign: (r) => (r.campaign_name || '').toLowerCase() || null,
  step: (r) => r.current_step,
  heat: (r) => r.hot_cold || null,
  next_action: (r) => (r.next_action_date ? r.next_action_date.slice(0, 10) : null),
};
// The direction a column starts in the first time you click it.
const SORT_DEFAULT_DIR = {
  marker: 'asc', name: 'asc', company: 'asc', type: 'asc', title: 'asc', campaign: 'asc',
  step: 'asc', heat: 'asc', next_action: 'asc',
};

// Reorder rows in place by the active column. Missing values always sink to the
// bottom regardless of direction (no priority/date/campaign = nothing to surface).
function sortRoster(rows) {
  const getVal = SORT_VALUE[rosterSort.by];
  if (!getVal) return;
  const sign = rosterSort.dir === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    const va = getVal(a), vb = getVal(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return sign * (va < vb ? -1 : va > vb ? 1 : 0);
  });
}

function setRosterSort(by) {
  if (rosterSort.by === by) rosterSort.dir = rosterSort.dir === 'asc' ? 'desc' : 'asc';
  else rosterSort = { by, dir: SORT_DEFAULT_DIR[by] };
  loadRoster();
}

function updateSortArrows() {
  document.querySelectorAll('#view-roster th.sortable').forEach((th) => {
    const active = th.dataset.sort === rosterSort.by;
    th.classList.toggle('active', active);
    th.querySelector('.arrow').textContent = active ? (rosterSort.dir === 'asc' ? ' ▲' : ' ▼') : '';
  });
}

async function loadRoster() {
  if (!companyId) return;
  const status = $('roster-status').value;
  let rows = await api(withQS('/people', companyQS(), status ? `status=${status}` : ''));
  const type = $('roster-type').value;
  if (type) rows = rows.filter((r) => r.type === type);
  $('roster-table').classList.toggle('show-company', companyId === 'all');
  sortRoster(rows);
  updateSortArrows();
  const body = $('roster-body'); body.innerHTML = '';
  $('roster-empty').classList.toggle('hidden', rows.length > 0);
  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><img class="thumb" src="${photoUrl(r)}"></td>
      <td class="emoji-cell"></td>
      <td class="name-cell">${esc(r.name)} ${stagedIcon(r.staged)}</td>
      <td class="company-col">${esc(r.company_name) || ''}</td>
      <td>${typeBadge(r.type)}</td>
      <td>${esc(r.title)}</td>
      <td>${esc(r.campaign_name) || '<span class="muted">—</span>'}</td>
      <td>${r.current_step ? 'step ' + r.current_step : ''}</td>
      <td>${heatBadge(r.hot_cold)}</td>
      <td class="muted">${fmtDate(r.next_action_date)}</td>`;
    tr.onclick = (e) => { if (!e.target.closest('.nick, .nick-input, .emoji-chip, .emoji-input')) openPerson(r.id); };
    tr.querySelector('.name-cell').appendChild(makeNick(r.id, r.label || ''));
    tr.querySelector('.emoji-cell').appendChild(makeEmoji(r.id, r.emoji || ''));
    body.appendChild(tr);
  }
}

// ---------- Person detail ----------
// Remember which list to return to (Back button). Don't overwrite when openPerson is
// re-called to refresh while already on the detail view.
let personReturn = 'today';
async function openPerson(id) {
  if (currentView !== 'person' && currentView !== 'campaign-edit') personReturn = currentView;
  person = await api(`/people/${id}`);
  $('p-photo').src = photoUrl(person);
  $('p-name').textContent = person.name || '';
  $('p-subtitle').textContent = [person.title, person.company_name].filter(Boolean).join(' · ');
  const li = $('p-linkedin');
  if (person.linkedin_url) { li.href = person.linkedin_url; li.classList.remove('hidden'); }
  else { li.removeAttribute('href'); li.classList.add('hidden'); }
  // Deep link into Sniper (shared people table → same id) to view the full enriched profile.
  $('p-sniper').href = `${location.protocol}//${location.hostname}:7700/?person=${person.id}`;
  $('p-sniper').classList.remove('hidden');
  // Email (entered in Sniper) shown as a click-to-compose mailto, hidden when absent.
  const em = $('p-email');
  if (person.email) { em.href = `mailto:${person.email}`; $('p-email-text').textContent = person.email; em.classList.remove('hidden'); }
  else { em.removeAttribute('href'); em.classList.add('hidden'); }
  $('p-label').value = person.label || '';
  $('p-hot_cold').value = person.hot_cold || '';
  $('p-emoji').value = person.emoji || '';
  $('p-next_action_date').value = person.next_action_date ? person.next_action_date.slice(0, 10) : '';
  $('p-staged').checked = !!person.staged;
  $('p-status').value = person.status || 'active';
  $('p-ai_summary').value = person.ai_summary || '';
  $('p-ai_ins').value = person.ai_ins || '';
  $('p-my_notes').value = person.my_notes || '';

  // Campaign assign dropdown
  const sel = $('p-assign-campaign');
  sel.innerHTML = campaigns.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');

  renderRun();
  show('person');
}

function renderRun() {
  const run = person.active_run;
  const label = $('p-run-label');
  const stepsHost = $('p-steps');
  $('p-add-step').classList.toggle('hidden', !run);
  if (!run) {
    label.textContent = 'No active run. Assign a campaign or run bespoke.';
    stepsHost.innerHTML = '';
    return;
  }
  label.innerHTML = `Active run: <strong>${esc(run.campaign_name) || 'bespoke'}</strong> · current step ${run.current_step}`;
  stepsHost.innerHTML = '';
  run.steps.forEach((s, i) => stepsHost.appendChild(stepCard(s, i, run.steps)));
  // Re-renders (e.g. reorder) rebuild the cards; fit the message boxes to their
  // content now that they're in the DOM, so they don't collapse to the minimum.
  requestAnimationFrame(() => stepsHost.querySelectorAll('textarea').forEach(autosize));
}

function stepCard(s, idx, steps) {
  const el = document.createElement('div');
  el.className = 'step' + (s.sent ? ' sent' : '');
  el.innerHTML = `
    <div class="step-head">
      <span class="num">${s.step_order}</span>
      <span class="step-move">
        <button class="move-up sm" title="Move earlier" ${idx === 0 ? 'disabled' : ''}>▲</button>
        <button class="move-down sm" title="Move later" ${idx === steps.length - 1 ? 'disabled' : ''}>▼</button>
      </span>
      ${channelField(s.channel)}
      <input data-f="purpose" value="${esc(s.purpose)}" placeholder="purpose" style="flex:1">
    </div>
    <textarea data-f="customized_text" placeholder="Message text (draft, then edit)…">${esc(s.customized_text)}</textarea>
    <div class="draft-row">
      <button class="draft sm">✨ Draft</button>
      <select class="draft-provider sm" title="provider">
        <option value="">default (local)</option>
        <option value="local">local (qwen3)</option>
        <option value="anthropic">Claude</option>
      </select>
      <span class="spacer"></span>
      <button class="save-step primary sm">Save step</button>
    </div>
    <div class="step-controls">
      ${s.sent ? '' : '<button class="sent-today sm">✓ Sent today</button>'}
      <label><input type="checkbox" data-f="sent" ${s.sent ? 'checked' : ''}> sent</label>
      <label>at <input type="date" data-f="sent_at" value="${s.sent_at ? s.sent_at.slice(0, 10) : ''}"></label>
      <label><input type="checkbox" data-f="response_received" ${s.response_received ? 'checked' : ''}> response</label>
    </div>`;

  const collect = () => {
    const out = {};
    el.querySelectorAll('[data-f]').forEach((inp) => {
      const f = inp.dataset.f;
      if (inp.type === 'checkbox') out[f] = inp.checked;
      else out[f] = inp.value === '' ? null : inp.value;
    });
    // date-only -> keep as date; server stores timestamptz
    return out;
  };

  // Save this step's fields. Pass overrides to set values without touching the inputs
  // first (e.g. the "Sent today" shortcut sets sent + sent_at in one go).
  const commit = async (overrides = {}) => {
    const payload = { ...collect(), ...overrides };
    try {
      await api(`/person-campaign-steps/${s.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      await openPerson(person.id); // refresh (side-effects may have moved next_action_date)
      // Marking a step sent recomputes the contact's due date from the next step's delay —
      // surface it so the delay field's effect is visible rather than silent.
      if (payload.sent && person.next_action_date) {
        toast(`Step saved — next touch due ${fmtDate(person.next_action_date)}`);
      } else {
        toast('Step saved');
      }
    } catch (e) { toast(e.message); }
  };
  el.querySelector('.save-step').onclick = () => commit();
  // One-click "sent today": mark sent and stamp today's date, saving any draft edits too.
  el.querySelector('.sent-today')?.addEventListener('click', () => commit({ sent: true, sent_at: todayStr() }));
  el.querySelector('.draft').onclick = async () => {
    const btn = el.querySelector('.draft'); const prev = btn.textContent;
    btn.textContent = '… drafting'; btn.disabled = true;
    try {
      const provider = el.querySelector('.draft-provider').value || undefined;
      const d = await api('/draft', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ person_id: person.id, step_id: s.id, provider }),
      });
      const ta = el.querySelector('[data-f="customized_text"]');
      ta.value = d.text;
      autosize(ta); // programmatic set fires no 'input' event
      toast(`Drafted (${d.provider})`);
    } catch (e) { toast(e.message); }
    finally { btn.textContent = prev; btn.disabled = false; }
  };
  // Reorder: swap this step with its neighbour and renumber the run server-side.
  // Note: like Save/Send, this re-renders the steps — save any in-progress draft first.
  const move = async (delta) => {
    const to = idx + delta;
    if (to < 0 || to >= steps.length) return;
    const order = steps.map((x) => x.id);
    [order[idx], order[to]] = [order[to], order[idx]];
    try {
      const updated = await api(`/person-campaigns/${person.active_run.id}/reorder`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order }),
      });
      person.active_run.steps = updated;
      renderRun();
      toast('Step reordered');
    } catch (e) { toast(e.message); }
  };
  el.querySelector('.move-up').onclick = () => move(-1);
  el.querySelector('.move-down').onclick = () => move(1);
  wireChannels(el);
  return el;
}

async function saveTracker() {
  const body = {
    label: $('p-label').value.trim() || null,
    hot_cold: $('p-hot_cold').value || null,
    emoji: $('p-emoji').value.trim() || null,
    next_action_date: $('p-next_action_date').value || null,
    staged: $('p-staged').checked,
    status: $('p-status').value,
  };
  await api(`/people/${person.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  toast('Tracker saved');
}
async function saveNotes() {
  await api(`/people/${person.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ my_notes: $('p-my_notes').value }) });
  toast('Notes saved');
}
async function saveContext() {
  await api(`/people/${person.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ai_summary: $('p-ai_summary').value, ai_ins: $('p-ai_ins').value }),
  });
  toast('Context saved');
}
async function archivePerson() {
  await api(`/people/${person.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'inactive' }) });
  toast('Archived (set inactive)');
  show('roster'); loadRoster();
}
async function deletePerson() {
  if (!confirm(`Permanently delete ${person.name || 'this contact'}?\n\nThis removes the contact (from Sniper too) AND all their campaign runs and message history. This cannot be undone.\n\nTip: "Archive" instead keeps everything and just hides them from active views.`)) return;
  await api(`/people/${person.id}`, { method: 'DELETE' });
  toast('Deleted');
  show('roster'); loadRoster();
}
async function assign(bespoke) {
  const body = bespoke
    ? { campaign_id: null, start_step: 1 }
    : { campaign_id: Number($('p-assign-campaign').value), start_step: Number($('p-assign-step').value) || 1 };
  await api(`/people/${person.id}/assign`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  toast(bespoke ? 'Bespoke run started' : 'Campaign assigned (prior run archived)');
  await openPerson(person.id);
}
async function addBespokeStep() {
  if (!person.active_run) return;
  await api('/person-campaign-steps', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ person_campaign_id: person.active_run.id }) });
  await openPerson(person.id);
}

// ---------- Campaigns ----------
async function loadCampaigns() {
  await loadCampaignList();
  const body = $('campaigns-body'); body.innerHTML = '';
  for (const c of campaigns) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${esc(c.name)}</td><td>${esc(c.category)}</td><td class="muted">${esc(c.goal)}</td><td>${c.step_count}</td>`;
    tr.onclick = () => editCampaign(c.id);
    body.appendChild(tr);
  }
}
async function editCampaign(id) {
  editingCampaign = await api(`/campaigns/${id}`);
  $('ce-name').value = editingCampaign.name || '';
  $('ce-category').value = editingCampaign.category || '';
  $('ce-goal').value = editingCampaign.goal || '';
  renderCampaignSteps();
  show('campaign-edit');
  headerClean();
}
function newCampaign() {
  editingCampaign = { id: null, name: '', category: '', goal: '', steps: [] };
  $('ce-name').value = ''; $('ce-category').value = ''; $('ce-goal').value = '';
  renderCampaignSteps();
  show('campaign-edit');
  headerClean();
}
function renderCampaignSteps() {
  const host = $('ce-steps'); host.innerHTML = '';
  if (!editingCampaign.id) { host.innerHTML = '<p class="muted">Save the campaign first, then add steps.</p>'; return; }
  if (editingCampaign.steps.length) {
    const head = document.createElement('div');
    head.className = 'cstep cstep-head';
    head.innerHTML = `
      <span title="Step order in the sequence">#</span>
      <span>Channel</span>
      <span>Purpose / message</span>
      <span title="Days to wait after the previous step before this one is due">Wait (days)</span>
      <span>Actions</span>`;
    host.appendChild(head);
  }
  editingCampaign.steps.forEach((s, i) => host.appendChild(campaignStepRow(s, i, editingCampaign.steps)));
}
function campaignStepRow(s, idx, steps) {
  const el = document.createElement('div');
  el.className = 'cstep';
  el.dataset.stepId = s.id;
  el.innerHTML = `
    <div class="cstep-order">
      <span class="num">${s.step_order}</span>
      <span class="step-move">
        <button class="move-up sm" title="Move earlier" ${idx === 0 ? 'disabled' : ''}>▲</button>
        <button class="move-down sm" title="Move later" ${idx === steps.length - 1 ? 'disabled' : ''}>▼</button>
      </span>
    </div>
    ${channelField(s.channel)}
    <div>
      <input data-f="purpose" value="${esc(s.purpose)}" placeholder="purpose" style="width:100%;margin-bottom:4px">
      <textarea data-f="skeleton_text" placeholder="skeleton text">${esc(s.skeleton_text)}</textarea>
    </div>
    <input data-f="default_delay_days" value="${s.default_delay_days ?? ''}" placeholder="days" title="Days to wait after the previous step before this step is due">
    <div class="step-actions">
      <button class="save sm primary" data-clean="Save" data-dirty="Save changes (unsaved)">Save</button>
      <button class="revert sm hidden" title="Discard unsaved edits to this step">Revert</button>
      <button class="del sm bad" title="Delete this step">Delete Step</button>
    </div>`;

  const saveBtn = el.querySelector('.save');
  const revertBtn = el.querySelector('.revert');
  const fields = [...el.querySelectorAll('[data-f]')];
  // Snapshot of the last-saved values, used by Revert and to clear the dirty flag.
  const snapshot = () => Object.fromEntries(fields.map((i) => [i.dataset.f, i.value]));
  let saved = snapshot();

  const markDirty = () => { dirtyBtn(saveBtn, true); revertBtn.classList.remove('hidden'); };
  const markClean = () => { dirtyBtn(saveBtn, false); revertBtn.classList.add('hidden'); };

  fields.forEach((i) => i.addEventListener('input', markDirty));

  // Save THIS step in place — no full re-render, so unsaved edits in other rows survive.
  saveBtn.onclick = async () => {
    const o = {};
    fields.forEach((i) => { o[i.dataset.f] = i.value === '' ? null : i.value; });
    try {
      await api(`/campaigns/${editingCampaign.id}/steps/${s.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o),
      });
      saved = snapshot();   // new baseline
      markClean();
      autosize(el.querySelector('textarea'));
      toast('Step saved');
    } catch (e) { toast(e.message); }
  };

  // Revert: restore this step's fields to the last-saved values, clear dirty.
  revertBtn.onclick = () => {
    fields.forEach((i) => { i.value = saved[i.dataset.f]; });
    autosize(el.querySelector('textarea'));
    markClean();
  };

  el.querySelector('.del').onclick = async () => {
    if (!confirm('Delete this step?')) return;
    try { await api(`/campaigns/${editingCampaign.id}/steps/${s.id}`, { method: 'DELETE' }); await editCampaign(editingCampaign.id); }
    catch (e) { toast(e.message); }
  };

  // Reorder: swap this step with its neighbour and renumber the campaign server-side.
  // Like Delete, this re-renders all steps — save any in-progress edits to other rows first.
  const move = async (delta) => {
    const to = idx + delta;
    if (to < 0 || to >= steps.length) return;
    const order = steps.map((x) => x.id);
    [order[idx], order[to]] = [order[to], order[idx]];
    try {
      const updated = await api(`/campaigns/${editingCampaign.id}/reorder`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order }),
      });
      editingCampaign.steps = updated;
      renderCampaignSteps();
      toast('Step reordered');
    } catch (e) { toast(e.message); }
  };
  el.querySelector('.move-up').onclick = () => move(-1);
  el.querySelector('.move-down').onclick = () => move(1);

  wireChannels(el);
  return el;
}

// A Save button doubles as its own unsaved-edits indicator: when dirty it turns amber
// and its label flips to the "dirty" text. Labels are read from data-attributes.
function dirtyBtn(btn, on) {
  if (!btn) return;
  btn.classList.toggle('dirty', on);
  btn.textContent = on ? (btn.dataset.dirty || 'Save changes (unsaved)') : (btn.dataset.clean || 'Save');
}

// "Save campaign" saves the header fields (name / category / goal) only.
async function saveCampaign() {
  const body = { name: $('ce-name').value, category: $('ce-category').value, goal: $('ce-goal').value };
  if (!body.name.trim()) return toast('Name required');

  if (!editingCampaign.id) {
    // New campaign: create it first (steps are added afterward via "+ Add step").
    const c = await api('/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    toast('Campaign created');
    return editCampaign(c.id);
  }
  await api(`/campaigns/${editingCampaign.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  editingCampaign = { ...editingCampaign, ...body };
  headerClean();
  toast('Campaign saved');
}

// Header section dirty/clean + revert (baseline is editingCampaign's saved values).
function headerDirty() { dirtyBtn($('ce-save'), true); $('ce-revert').classList.remove('hidden'); }
function headerClean() { dirtyBtn($('ce-save'), false); $('ce-revert').classList.add('hidden'); }
function revertCampaignHeader() {
  $('ce-name').value = editingCampaign.name || '';
  $('ce-category').value = editingCampaign.category || '';
  $('ce-goal').value = editingCampaign.goal || '';
  headerClean();
}
['ce-name', 'ce-category', 'ce-goal'].forEach((id) => $(id).addEventListener('input', headerDirty));
$('ce-revert').onclick = revertCampaignHeader;
async function addCampaignStep() {
  if (!editingCampaign.id) return toast('Save the campaign first');
  await api(`/campaigns/${editingCampaign.id}/steps`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: 'linkedin', purpose: '', skeleton_text: '' }) });
  await editCampaign(editingCampaign.id);
}
async function deleteCampaign() {
  if (!editingCampaign.id) return;
  if (!confirm('Delete this campaign? Existing person runs keep their copied steps.')) return;
  await api(`/campaigns/${editingCampaign.id}`, { method: 'DELETE' });
  toast('Campaign deleted'); show('campaigns'); loadCampaigns();
}

// ---------- Drafting prompt editor (modal) ----------
async function openPromptModal() {
  const host = $('pm-sections');
  host.innerHTML = '<p class="muted">Loading…</p>';
  $('prompt-modal').classList.remove('hidden');
  try {
    const { sections } = await api('/settings/prompt');
    host.innerHTML = `
      <div class="pm-cols">
        <div class="pm-col">
          <h3 class="pm-col-title">Core — biggest impact on the message</h3>
          <div id="pm-primary"></div>
        </div>
        <div class="pm-col">
          <h3 class="pm-col-title">Guardrails &amp; format — usually set once</h3>
          <div id="pm-secondary"></div>
        </div>
      </div>`;
    const prim = $('pm-primary');
    const sec = $('pm-secondary');
    for (const s of sections) (s.primary ? prim : sec).appendChild(promptSectionRow(s, !s.primary));
    // Fit the expanded (primary) boxes to their content now that they're in the DOM —
    // a detached textarea reports scrollHeight 0. Collapsed ones fit on expand.
    requestAnimationFrame(() => prim.querySelectorAll('.pm-body').forEach(autosize));
  } catch (e) {
    host.innerHTML = `<p class="muted">Couldn't load prompt: ${esc(e.message)}</p>`;
  }
}
function closePromptModal() { $('prompt-modal').classList.add('hidden'); }

// Build one editable section. `collapsed` renders it as a <details> (used for the
// secondary column); otherwise it's always expanded (primary column).
function promptSectionRow(s, collapsed) {
  const bodyHtml = `
    <div class="pm-actions">
      <span class="spacer"></span>
      <button class="pm-save primary sm">Save</button>
      <button class="pm-reset sm" title="Restore the built-in default for this section">Reset</button>
    </div>
    <p class="pm-help muted"></p>
    <textarea class="pm-body" spellcheck="false"></textarea>`;
  let el;
  if (collapsed) {
    el = document.createElement('details');
    el.className = 'pm-section pm-collapsible';
    el.innerHTML = `<summary><span class="pm-label"></span><span class="pm-badge"></span></summary>${bodyHtml}`;
  } else {
    el = document.createElement('div');
    el.className = 'pm-section';
    el.innerHTML = `<div class="pm-section-head"><span class="pm-label"></span><span class="pm-badge"></span></div>${bodyHtml}`;
  }
  el.querySelector('.pm-label').textContent = s.label;
  el.querySelector('.pm-help').textContent = s.help || '';
  const ta = el.querySelector('.pm-body');
  ta.value = s.effective || '';
  ta.addEventListener('input', () => autosize(ta));
  // A textarea has no measurable height while detached or inside a closed <details>.
  // Collapsed sections fit on expand; expanded ones are fit by the caller after append.
  if (collapsed) el.addEventListener('toggle', () => { if (el.open) autosize(ta); });

  const badge = el.querySelector('.pm-badge');
  const setBadge = (overridden) => {
    badge.textContent = overridden ? 'custom' : 'default';
    badge.classList.toggle('custom', overridden);
  };
  setBadge(s.overridden);

  el.querySelector('.pm-save').onclick = async () => {
    const btn = el.querySelector('.pm-save'); const prev = btn.textContent;
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const r = await api(`/settings/prompt/${s.key}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: ta.value }),
      });
      ta.value = r.effective || '';
      autosize(ta);
      setBadge(r.overridden);
      toast(r.overridden ? `Saved "${s.label}"` : `"${s.label}" reset to default (was blank)`);
    } catch (e) { toast(e.message); }
    finally { btn.disabled = false; btn.textContent = prev; }
  };
  el.querySelector('.pm-reset').onclick = async () => {
    if (!confirm(`Reset "${s.label}" to the built-in default? Your edits to this section will be discarded.`)) return;
    try {
      const r = await api(`/settings/prompt/${s.key}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: '' }),
      });
      ta.value = r.effective || '';
      autosize(ta);
      setBadge(false);
      toast(`"${s.label}" reset to default`);
    } catch (e) { toast(e.message); }
  };
  return el;
}

// ---------- wire up ----------
$('tab-today').onclick = () => { show('today'); loadToday(); };
$('tab-tomorrow').onclick = () => { show('tomorrow'); loadWeek(); };
$('tab-roster').onclick = () => { show('roster'); loadRoster(); };
$('tab-campaigns').onclick = () => { show('campaigns'); loadCampaigns(); };
$('company').onchange = (e) => { companyId = e.target.value === 'all' ? 'all' : Number(e.target.value); reloadCurrent(); };
$('refresh-today').onclick = loadToday;
$('refresh-tomorrow').onclick = loadWeek;
$('refresh-roster').onclick = loadRoster;
$('today-type').onchange = loadToday;
$('tomorrow-type').onchange = loadWeek;
$('roster-status').onchange = loadRoster;
$('roster-type').onchange = loadRoster;
document.querySelectorAll('#view-roster th.sortable').forEach((th) => {
  th.onclick = () => setRosterSort(th.dataset.sort);
});
document.querySelectorAll('#today-table th.sortable').forEach((th) => {
  th.onclick = () => setTodaySort(th.dataset.sort);
});
document.querySelectorAll('#tomorrow-table th.sortable').forEach((th) => {
  th.onclick = () => setTomorrowSort(th.dataset.sort);
});
$('back-from-person').onclick = () => { show(personReturn); reloadCurrent(); };
$('p-refresh').onclick = () => { if (person) openPerson(person.id).then(() => toast('Refreshed')).catch((e) => toast(e.message)); };
$('p-save-tracker').onclick = () => saveTracker().catch((e) => toast(e.message));
$('p-save-notes').onclick = () => saveNotes().catch((e) => toast(e.message));
$('p-save-context').onclick = () => saveContext().catch((e) => toast(e.message));
$('p-archive').onclick = () => archivePerson().catch((e) => toast(e.message));
$('p-delete').onclick = () => deletePerson().catch((e) => toast(e.message));
$('p-assign').onclick = () => assign(false).catch((e) => toast(e.message));
$('p-assign-bespoke').onclick = () => assign(true).catch((e) => toast(e.message));
$('p-add-step').onclick = () => addBespokeStep().catch((e) => toast(e.message));
$('new-campaign').onclick = newCampaign;
$('back-from-campaign').onclick = () => { show('campaigns'); loadCampaigns(); };
$('ce-save').onclick = () => saveCampaign().catch((e) => toast(e.message));
$('ce-delete').onclick = () => deleteCampaign().catch((e) => toast(e.message));
$('ce-add-step').onclick = () => addCampaignStep().catch((e) => toast(e.message));
document.querySelectorAll('.open-prompt').forEach((b) => { b.onclick = openPromptModal; });
$('pm-close').onclick = closePromptModal;
$('prompt-modal').addEventListener('click', (e) => { if (e.target.id === 'prompt-modal') closePromptModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('prompt-modal').classList.contains('hidden')) closePromptModal(); });

// ---------- boot ----------
(async () => {
  try {
    await loadCompanies();
    await loadCampaignList();
    await loadToday();
    // Deep link: /?person=ID opens that contact directly (used by the SpecOps cross-link).
    const pid = Number(new URLSearchParams(location.search).get('person'));
    if (Number.isInteger(pid) && pid > 0) await openPerson(pid).catch((e) => toast(e.message));
  } catch (e) { toast(e.message); }
})();
