// uav SPA — vanilla JS. A radar of open job postings at foundational-model companies, with
// per-role application tracking + an aging timer (re-apply every 7-14 days), plus an activity log.
const $ = (id) => document.getElementById(id);

// --- Theme + cross-app links (shared chrome) ---
(function initChrome() {
  const host = location.hostname;
  const set = (id, port) => { const a = $(id); if (a) a.href = `${location.protocol}//${host}:${port}/`; };
  set('link-sniper', 7700); set('link-medic', 7701); set('link-engineer', 7702); set('link-specops', 7703);
  set('link-support', 7707);
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
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), 2600);
}
const jsonPost = (path, obj) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: obj ? JSON.stringify(obj) : undefined });

// --- State ---
let CONFIG = { reapplySoftDays: 7, reapplyHardDays: 14, newDays: 3, sources: [] };
let SOURCE_LABEL = {};
let SOURCE_CAREERS = {}; // source key -> overall careers-page URL (links the company group header)
let SOURCE_COOLDOWN = {}; // source key -> re-apply cooldown days (OpenAI/Google), null when none
let statusFilter = 'open';
let sourceFilter = '';
let asideOpen = false; // is the "Set aside" (rejected/not-interested) section expanded?
// Per-company collapsed sections (persisted): a Set of source keys whose role list is hidden, so
// the board is easier to scan/scroll. Survives reloads via localStorage.
let collapsed = new Set(JSON.parse(localStorage.getItem('uav-collapsed') || '[]'));
const saveCollapsed = () => localStorage.setItem('uav-collapsed', JSON.stringify([...collapsed]));
// Per-company application-quota status (source key → {used,max,windowDays,full,...}) from /api/quota,
// for companies that cap applications in a rolling window (e.g. Google 3/30d, OpenAI 5/180d).
let quota = {};

// Custom company-group order (persisted): an array of source keys. Keys listed here render in this
// order; any company NOT listed (e.g. a newly-added source) falls back to its config order, after
// the listed ones. Set by drag-and-drop of the group headers.
let groupOrder = JSON.parse(localStorage.getItem('uav-group-order') || '[]');
const saveGroupOrder = () => localStorage.setItem('uav-group-order', JSON.stringify(groupOrder));
// Stable-sort keys by their position in groupOrder; unlisted keys keep their incoming (config) order.
function applyGroupOrder(keys) {
  const pos = new Map(groupOrder.map((k, i) => [k, i]));
  return [...keys].sort((a, b) => (pos.has(a) ? pos.get(a) : Infinity) - (pos.has(b) ? pos.get(b) : Infinity));
}
let viewMode = localStorage.getItem('uav-view') === 'list' ? 'list' : 'cards'; // radar layout

// --- Helpers ---
const EVENT_META = {
  opened: { cls: 'ev-opened', label: 'opened' },
  reopened: { cls: 'ev-reopened', label: 'reopened' },
  closed: { cls: 'ev-closed', label: 'closed' },
  applied: { cls: 'ev-applied', label: 'applied' },
  reapplied: { cls: 'ev-applied', label: 're-applied' },
  rejected: { cls: 'ev-rejected', label: 'rejected' },
  not_interested: { cls: 'ev-rejected', label: 'not interested' },
  reactivated: { cls: 'ev-reopened', label: 'reactivated' },
};
const DISP_LABEL = { active: 'Active', rejected: 'Rejected', not_interested: 'Not interested' };

// Activity filter: each chip is a group of underlying event_type values. Toggling a chip off hides
// that group from the timeline (server-side, so the 50-row cap counts only what's shown). Persisted.
const EVENT_GROUPS = {
  opened: ['opened', 'reopened', 'reactivated'],
  applied: ['applied', 'reapplied'],
  closed: ['closed'],
  rejected: ['rejected'],
  not_interested: ['not_interested'],
};
const ALL_GROUPS = Object.keys(EVENT_GROUPS);
let eventFilter = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem('uav-event-filter'));
    if (Array.isArray(saved)) return saved.filter((g) => ALL_GROUPS.includes(g));
  } catch { /* ignore */ }
  return [...ALL_GROUPS]; // default: show everything
})();

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
// Today as YYYY-MM-DD in local time — caps the applied-date picker so you can't pick the future.
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function relTime(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 90) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

// Re-apply thresholds for a company: normally the global soft/hard cadence, but a company with a
// re-apply cooldown (OpenAI 180d, Google 30d — they won't take another application sooner) ages
// against that instead, with the same soft→hard grace width past it.
function reapplyThresholds(src) {
  const cd = SOURCE_COOLDOWN[src];
  if (cd && cd > CONFIG.reapplySoftDays) {
    return { soft: cd, hard: cd + (CONFIG.reapplyHardDays - CONFIG.reapplySoftDays) };
  }
  return { soft: CONFIG.reapplySoftDays, hard: CONFIG.reapplyHardDays };
}

// The aging badge for an applied role: green fresh, amber at soft cadence, red at hard cadence.
// Rejected / not-interested roles never nag: the badge stays informational (no due/re-apply note).
function reapplyBadge(p) {
  const days = p.days_since_applied;
  if (days == null) return '';
  let cls = 'fresh', note = '';
  if (p.disposition === 'active') {
    const { soft, hard } = reapplyThresholds(p.source);
    if (days >= hard) { cls = 'overdue'; note = ' · re-apply!'; }
    else if (days >= soft) { cls = 'due'; note = ' · due'; }
  }
  return `<span class="age-badge ${cls}">applied ${days}d ago${note}</span>`;
}

function groupChips(groups, { exclude = [] } = {}) {
  if (!Array.isArray(groups) || !groups.length) return '';
  // Show department/team/office/remote chips. Skip raw `location` (it's in the meta line) and
  // `country` (always the filtered country, e.g. "United States" — redundant noise on the card).
  // `exclude` drops extra types (the list view trims department/team/office to cut clutter, and
  // because office duplicates the location text). Remote leads — the most useful flag at a glance.
  const skip = new Set(['location', 'country', ...exclude]);
  const visible = groups.filter((g) => !skip.has(g.type));
  visible.sort((a, b) => (b.type === 'remote' ? 1 : 0) - (a.type === 'remote' ? 1 : 0));
  return visible.map((g) => {
    const label = g.type === 'remote' ? '🏠 remote' : esc(g.name);
    return `<span class="chip ${esc(g.type)}">${label}</span>`;
  }).join('');
}

function dispSelect(p) {
  const opt = (v) => `<option value="${v}"${p.disposition === v ? ' selected' : ''}>${DISP_LABEL[v]}</option>`;
  return `<select class="disp" data-id="${p.id}" title="Set status">${opt('active')}${opt('rejected')}${opt('not_interested')}</select>`;
}

// SpecOps stage keys → labels (mirrors specops STAGES) for the "In SpecOps · <stage>" badge.
const SPECOPS_STAGE = {
  lead: 'Pending Apply', outreach: 'Applied / Staged', outreach_today: 'Pending Draft',
  completed_outreach: 'Sent / Drafted', hm_reply: 'HM Reply',
  screen_interview: 'Screen & Interview', closed: 'Decision',
};
// Link a posting to SpecOps (:7703). If already linked to an opportunity, a badge that opens the
// SpecOps board filtered to that company; otherwise a "Send to SpecOps" deep link that opens the
// New-Opportunity modal pre-filled (company resolved by name on the SpecOps side). URLSearchParams
// URL-encodes every value.
function specOpsLink(p) {
  const base = `${location.protocol}//${location.hostname}:7703/`;
  if (p.opportunity_id) {
    const stage = SPECOPS_STAGE[p.opportunity_stage] || p.opportunity_stage || '';
    return `<a class="link specops-badge" href="${base}?company_id=${p.company_id}" target="_blank" rel="noopener">✓ In SpecOps${stage ? ' · ' + esc(stage) : ''} ↗</a>`;
  }
  const q = new URLSearchParams({
    newOpp: '1', company: SOURCE_LABEL[p.source] || p.source,
    role_title: p.title || '', job_posting_url: p.url || '', location: p.location || '',
    job_posting_id: String(p.id),
  });
  return `<a class="link specops-send" href="${base}?${q}" target="_blank" rel="noopener">Send to SpecOps ↗</a>`;
}

// The apply / re-apply / applied-date controls — shared by the card and list-row layouts so the
// delegated data-act / input.age-date handlers work identically in both.
function appliedControl(p) {
  return p.last_applied_at != null
    ? `<div class="apply-state">
         ${reapplyBadge(p)}
         <input type="date" class="age-date" data-id="${p.id}" value="${p.last_applied_on || ''}" max="${todayStr()}" title="Change the date you applied">
         ${p.application_count > 1 ? `<span class="muted sm">×${p.application_count}</span>` : ''}
         <button class="sm" data-act="reapply" data-id="${p.id}">Re-applied today</button>
         <button class="sm ghost" data-act="unapply" data-id="${p.id}" title="Undo applied">✕</button>
       </div>`
    : `<div class="apply-state"><button class="sm" data-act="apply" data-id="${p.id}">＋ Mark applied</button><span class="not-applied-warn" title="Not applied yet">⚠️</span></div>`;
}

// The posting title with an inline ↗ link to the posting (compact — frees up the meta line).
function titleLink(p) {
  return `${esc(p.title)}${p.url ? ` <a class="link open-arrow" href="${esc(p.url)}" target="_blank" rel="noopener" title="Open posting">↗</a>` : ''}`;
}

function roleCard(p) {
  const applied = p.last_applied_at != null;
  const closed = p.closed_at != null;
  return `<div class="role-card${closed ? ' closed' : ''}${applied ? ' is-applied' : ''}${p.is_new ? ' is-new' : ''}">
    <div class="rc-head">
      <div class="rc-title">${titleLink(p)}</div>
      ${p.is_new ? '<span class="new-badge">✨ NEW</span>' : ''}
      ${closed ? '<span class="chip closed-chip">closed</span>' : ''}
    </div>
    <div class="rc-meta">
      ${p.location ? `<span>📍 ${esc(p.location)}</span>` : ''}
      <span>seen since ${esc(p.first_seen_at)}</span>
      ${specOpsLink(p)}
    </div>
    <div class="rc-chips">${groupChips(p.groups)}</div>
    <div class="rc-foot">
      ${appliedControl(p)}
      <span class="spacer"></span>
      ${dispSelect(p)}
    </div>
  </div>`;
}

// Dense row for the list view — easier to scan a long radar than cards. Location sits under the
// title; chips are trimmed to remote/country (department/team/office removed to cut clutter, and
// office duplicates the location); the applied state is pushed to the far right for quick scanning.
function roleRow(p) {
  const applied = p.last_applied_at != null;
  const closed = p.closed_at != null;
  const chips = groupChips(p.groups, { exclude: ['department', 'team', 'office'] });
  return `<div class="role-row${closed ? ' closed' : ''}${applied ? ' is-applied' : ''}${p.is_new ? ' is-new' : ''}">
    <div class="rr-left">
      <div class="rr-title">
        ${p.is_new ? '<span class="new-badge">✨ NEW</span>' : ''}
        <span class="rr-title-text">${titleLink(p)}</span>
        ${closed ? '<span class="chip closed-chip">closed</span>' : ''}
      </div>
      ${p.location ? `<div class="rr-loc">📍 ${esc(p.location)}</div>` : ''}
    </div>
    ${chips ? `<div class="rr-chips">${chips}</div>` : ''}
    <div class="rr-actions">
      ${specOpsLink(p)}
      ${dispSelect(p)}
    </div>
    <div class="rr-apply">${appliedControl(p)}</div>
  </div>`;
}

// Compact one-line row for a set-aside (rejected / not-interested) role.
function asideRow(p) {
  const view = p.url ? `<a class="link" href="${esc(p.url)}" target="_blank" rel="noopener">↗</a>` : '';
  return `<div class="aside-row">
    <span class="ar-tag ${esc(p.disposition)}">${esc(DISP_LABEL[p.disposition] || p.disposition)}</span>
    <span class="ar-co">${esc(SOURCE_LABEL[p.source] || p.source)}</span>
    <span class="ar-title">${esc(p.title)}</span>
    <span class="spacer"></span>
    ${view}
    <button class="sm" data-act="restore" data-id="${p.id}">↩ Restore</button>
  </div>`;
}

// Sort within a company group: NEW first, then due-for-reapply, then not-yet-applied, then
// freshly-applied at the bottom.
function radarOrder(p) {
  if (p.is_new) return 0;
  if (p.days_since_applied != null && p.days_since_applied >= reapplyThresholds(p.source).soft) return 1;
  if (p.days_since_applied == null) return 2;
  return 3;
}

// Company group header — the name links to that company's overall careers page when known.
function groupHeaderName(src) {
  const label = esc(SOURCE_LABEL[src] || src);
  const url = SOURCE_CAREERS[src];
  return url
    ? `<a class="rg-name rg-careers" href="${esc(url)}" target="_blank" rel="noopener" title="Open ${label} careers page">${label} ↗</a>`
    : `<span class="rg-name">${label}</span>`;
}

// The header application-quota chip for a rate-limited company. Counts toward the company's rolling
// window (Google 3/30d, OpenAI 5/180d). Red when the quota is full (with days until you can apply
// again), amber when one slot is left, green otherwise. Empty for companies without a configured cap.
function quotaBadge(src) {
  const q = quota[src];
  if (!q) return '';
  const cls = q.full ? 'q-full' : (q.remaining <= 1 ? 'q-low' : 'q-ok');
  let days = '', title;
  if (q.full) {
    days = ` · ${q.nextSlotInDays}d`;
    title = `Application quota full — ${q.used}/${q.max} in the last ${q.windowDays}d. Next slot frees in ${q.nextSlotInDays} day${q.nextSlotInDays === 1 ? '' : 's'}.`;
  } else {
    if (q.oldestFreesInDays != null) days = ` · ${q.oldestFreesInDays}d`;
    title = `${q.used}/${q.max} applications used in the last ${q.windowDays}d`
      + (q.oldestFreesInDays != null ? ` · oldest ages out in ${q.oldestFreesInDays} day${q.oldestFreesInDays === 1 ? '' : 's'}` : '');
  }
  return `<span class="rg-quota ${cls}" title="${esc(title)}">${q.used}/${q.max}${days}</span>`;
}

function renderRadar(postings) {
  const wrap = $('radar');

  // Active roles drive the radar; rejected / not-interested are minimized into "Set aside".
  const active = postings.filter((p) => p.disposition === 'active');
  const aside = postings.filter((p) => p.disposition !== 'active');

  const list = viewMode === 'list';
  const renderItem = list ? roleRow : roleCard;
  const bySource = {};
  for (const p of active) (bySource[p.source] ||= []).push(p);

  // Show a section for EVERY configured company (in config order), even with zero roles — so an
  // armed-but-empty source like xAI is still visible. Narrow to one when the company filter is set.
  let keys = (CONFIG.sources || []).map((s) => s.key);
  if (!keys.length) keys = Object.keys(bySource).sort(); // fallback if config didn't load
  keys = applyGroupOrder(keys); // honor the user's drag-and-drop ordering
  keys = keys.filter((k) => !sourceFilter || k === sourceFilter);

  const groups = keys.map((src) => {
    const rows = (bySource[src] || []).sort((a, b) => radarOrder(a) - radarOrder(b));
    const pending = rows.filter((r) => r.last_applied_at == null).length; // roles not yet applied to
    const applied = rows.length - pending; // roles already applied to
    const capped = !!(quota[src] && quota[src].full); // at the application cap → unapplied roles aren't actionable
    const body = rows.length
      ? rows.map(renderItem).join('')
      : '<div class="rg-empty muted sm">No matching roles right now.</div>';
    const isCollapsed = collapsed.has(src);
    return `<div class="radar-group${isCollapsed ? ' collapsed' : ''}" data-src="${src}">
      <div class="rg-head" data-src="${src}" title="${isCollapsed ? 'Expand' : 'Collapse'} ${esc(SOURCE_LABEL[src] || src)}">
        <span class="rg-grip" title="Drag to reorder">⠿</span>
        <span class="rg-caret">${isCollapsed ? '▸' : '▾'}</span>
        ${groupHeaderName(src)}<span class="rg-meta">${quotaBadge(src)}${
          applied > 0
            ? `<span class="rg-applied" title="${applied} role${applied === 1 ? '' : 's'} applied to${pending === 0 ? ' — every open role' : ''}">${applied} applied${pending === 0 ? ' ✅' : ''}</span>`
            : ''
        }${
          pending > 0
            ? `<span class="rg-pending${capped ? ' capped' : ''}" title="${pending} role${pending === 1 ? '' : 's'} not applied to yet${capped ? ' — at the application cap, so not actionable right now' : ''}">${pending} not applied</span>`
            : ''
        }<span class="rg-count" title="${rows.length} open role${rows.length === 1 ? '' : 's'}">${rows.length}</span></span>
      </div>
      <div class="rg-list${list ? ' rg-list--list' : ''}">${body}</div>
    </div>`;
  });

  $('radar-empty').classList.toggle('hidden', groups.length > 0);

  const asideHtml = aside.length
    ? `<div class="aside-section${asideOpen ? ' open' : ''}">
         <button class="aside-toggle">${asideOpen ? '▾' : '▸'} Set aside (${aside.length})</button>
         <div class="aside-list">${aside.map(asideRow).join('')}</div>
       </div>`
    : '';

  wrap.innerHTML = groups.join('') + asideHtml;
}

function renderHistory(events) {
  const wrap = $('history');
  if (!events.length) { wrap.innerHTML = '<div class="empty sm">No activity yet.</div>'; return; }
  wrap.innerHTML = events.map((e) => {
    const m = EVENT_META[e.event_type] || { cls: '', label: e.event_type };
    const co = SOURCE_LABEL[e.source] || e.source;
    const title = e.url ? `<a class="link" href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title)}</a>` : esc(e.title);
    // A closure on a role you had applied to is a soft rejection — flag it in the log.
    const flag = e.had_applied ? ' (had Applied ⛔️)' : '';
    return `<div class="event">
      <span class="ev-dot ${m.cls}"></span>
      <div class="ev-body">
        <div class="ev-line"><span class="ev-type ${m.cls}">${m.label}${flag}</span> ${title}</div>
        <div class="ev-sub muted sm">${esc(co)} · ${relTime(e.created_at)}</div>
      </div>
    </div>`;
  }).join('');
}

// --- Data loading ---
async function loadRadar() {
  const params = new URLSearchParams({ status: statusFilter });
  if (sourceFilter) params.set('source', sourceFilter);
  const [postings, quotaList] = await Promise.all([
    api(`/api/postings?${params}`),
    api('/api/quota'),
  ]);
  quota = {};
  for (const q of quotaList) quota[q.source] = q;
  renderRadar(postings);
  updateCollapseToggle();
  $('radar-note').textContent =
    `${postings.length} role${postings.length === 1 ? '' : 's'} · re-apply cadence ${CONFIG.reapplySoftDays}–${CONFIG.reapplyHardDays}d`;
}
// The button reflects what clicking it will do: if every visible company is collapsed, the next
// click expands all; otherwise it collapses all.
function visibleSources() {
  return [...$('radar').querySelectorAll('.radar-group')].map((el) => el.dataset.src);
}
function updateCollapseToggle() {
  const srcs = visibleSources();
  const allCollapsed = srcs.length > 0 && srcs.every((s) => collapsed.has(s));
  const btn = $('collapse-toggle');
  btn.textContent = allCollapsed ? '⊞ Expand all' : '⊟ Collapse all';
  btn.disabled = srcs.length === 0;
}
async function loadHistory() {
  if (!eventFilter.length) { // every group hidden — nothing to show, skip the round-trip
    $('history').innerHTML = '<div class="empty sm">No event types selected.</div>';
    return;
  }
  const types = eventFilter.flatMap((g) => EVENT_GROUPS[g]);
  const events = await api(`/api/events?limit=50&types=${encodeURIComponent(types.join(','))}`);
  renderHistory(events);
}
const reload = () => Promise.all([loadRadar(), loadHistory()]);

// --- Events ---
$('refresh').onclick = async () => {
  const btn = $('refresh');
  btn.disabled = true; btn.textContent = '⟳ Scanning…';
  try {
    const s = await jsonPost('/api/refresh');
    const c = s.counts || {};
    const bits = [];
    if (c.opened) bits.push(`${c.opened} new`);
    if (c.reopened) bits.push(`${c.reopened} reopened`);
    if (c.closed) bits.push(`${c.closed} closed`);
    if (s.errors?.length) bits.push(`${s.errors.length} source error(s)`);
    toast(bits.length ? `Scan: ${bits.join(', ')}` : 'Scan complete — no changes');
    await reload();
  } catch (err) {
    toast(`Refresh failed: ${err.message}`);
  } finally {
    btn.disabled = false; btn.textContent = '⟳ Refresh now';
  }
};

$('status-filter').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-status]');
  if (!b) return;
  statusFilter = b.dataset.status;
  for (const x of $('status-filter').querySelectorAll('button')) x.classList.toggle('on', x === b);
  loadRadar();
});

$('source').addEventListener('change', (e) => { sourceFilter = e.target.value; loadRadar(); });

// Activity filter chips: toggle a group in/out of the timeline, persist, reload history.
function syncEventChips() {
  for (const b of $('event-filter').querySelectorAll('button[data-group]')) {
    b.classList.toggle('on', eventFilter.includes(b.dataset.group));
  }
}
$('event-filter').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-group]');
  if (!b) return;
  const g = b.dataset.group;
  eventFilter = eventFilter.includes(g) ? eventFilter.filter((x) => x !== g) : [...eventFilter, g];
  localStorage.setItem('uav-event-filter', JSON.stringify(eventFilter));
  syncEventChips();
  loadHistory();
});
syncEventChips();

// Cards ↔ List layout toggle (persisted). Re-renders the current radar in the chosen layout.
$('view-toggle').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]');
  if (!b) return;
  viewMode = b.dataset.view;
  localStorage.setItem('uav-view', viewMode);
  for (const x of $('view-toggle').querySelectorAll('button')) x.classList.toggle('on', x === b);
  loadRadar();
});

// Expand/collapse every visible company at once. Collapse-all unless they're all already collapsed.
$('collapse-toggle').addEventListener('click', () => {
  const srcs = visibleSources();
  const allCollapsed = srcs.length > 0 && srcs.every((s) => collapsed.has(s));
  if (allCollapsed) for (const s of srcs) collapsed.delete(s);
  else for (const s of srcs) collapsed.add(s);
  saveCollapsed();
  loadRadar();
});

// Apply / re-apply / unapply / restore + the Set-aside toggle (delegated on the radar).
$('radar').addEventListener('click', async (e) => {
  // Expand/collapse the minimized rejected/not-interested section.
  if (e.target.closest('.aside-toggle')) { asideOpen = !asideOpen; loadRadar(); return; }

  // Collapse/expand a company section. The careers link (.rg-careers) and the drag grip (.rg-grip)
  // keep their own behavior and don't toggle.
  const head = e.target.closest('.rg-head');
  if (head && !e.target.closest('.rg-careers') && !e.target.closest('.rg-grip')) {
    const src = head.dataset.src;
    if (collapsed.has(src)) collapsed.delete(src); else collapsed.add(src);
    saveCollapsed();
    loadRadar();
    return;
  }

  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const { act, id } = b.dataset;
  b.disabled = true;
  try {
    if (act === 'apply' || act === 'reapply') {
      await jsonPost(`/api/postings/${id}/apply`);
      toast(act === 'apply' ? 'Marked applied' : 'Re-apply timer reset');
    } else if (act === 'unapply') {
      await jsonPost(`/api/postings/${id}/unapply`);
      toast('Application cleared');
    } else if (act === 'restore') {
      await jsonPost(`/api/postings/${id}/status`, { disposition: 'active' });
      toast('Restored to active');
    }
    await reload();
  } catch (err) {
    toast(`Failed: ${err.message}`);
    b.disabled = false;
  }
});

// --- Drag-and-drop reordering of company groups (grip-gated, persisted to localStorage) ---
// A group is only draggable while its grip is pressed, so the rest of the header still click-toggles.
let dragSrc = null;
const clearDropHints = () => { for (const el of $('radar').querySelectorAll('.drop-before, .drop-after')) el.classList.remove('drop-before', 'drop-after'); };
const cleanupDrag = () => {
  clearDropHints();
  for (const el of $('radar').querySelectorAll('.radar-group')) { el.classList.remove('dragging'); el.draggable = false; }
  dragSrc = null;
};
// Where to drop relative to the group under the cursor: after it if past its vertical midpoint.
const dropsAfter = (e, group) => { const r = group.getBoundingClientRect(); return e.clientY > r.top + r.height / 2; };

$('radar').addEventListener('mousedown', (e) => {
  const grip = e.target.closest('.rg-grip');
  if (grip) { const g = grip.closest('.radar-group'); if (g) g.draggable = true; }
});
// A plain grip click (no drag) leaves the group draggable; reset it so stray drags can't start.
$('radar').addEventListener('mouseup', () => { if (!dragSrc) for (const el of $('radar').querySelectorAll('.radar-group[draggable="true"]')) el.draggable = false; });

$('radar').addEventListener('dragstart', (e) => {
  const g = e.target.closest('.radar-group');
  if (!g || !g.draggable) return;
  dragSrc = g.dataset.src;
  g.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', dragSrc); } catch { /* Firefox needs setData to begin a drag */ }
});

$('radar').addEventListener('dragover', (e) => {
  if (!dragSrc) return;
  const over = e.target.closest('.radar-group');
  if (!over) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  clearDropHints();
  if (over.dataset.src !== dragSrc) over.classList.add(dropsAfter(e, over) ? 'drop-after' : 'drop-before');
});

$('radar').addEventListener('drop', (e) => {
  if (!dragSrc) return;
  const over = e.target.closest('.radar-group');
  if (!over || over.dataset.src === dragSrc) { cleanupDrag(); return; }
  e.preventDefault();
  const after = dropsAfter(e, over);
  // Rebuild the order from the current DOM, move the dragged key, persist, re-render.
  const order = [...$('radar').querySelectorAll('.radar-group')].map((el) => el.dataset.src);
  order.splice(order.indexOf(dragSrc), 1);
  let to = order.indexOf(over.dataset.src);
  if (after) to += 1;
  order.splice(to, 0, dragSrc);
  groupOrder = order;
  saveGroupOrder();
  cleanupDrag();
  loadRadar();
});

$('radar').addEventListener('dragend', cleanupDrag);

// Card-level change events: disposition dropdown + the editable applied-date picker.
$('radar').addEventListener('change', async (e) => {
  const sel = e.target.closest('select.disp');
  if (sel) {
    const id = sel.dataset.id;
    const disposition = sel.value;
    sel.disabled = true;
    try {
      await jsonPost(`/api/postings/${id}/status`, { disposition });
      toast(disposition === 'active' ? 'Active' : `Set aside: ${DISP_LABEL[disposition]}`);
      await reload();
    } catch (err) {
      toast(`Failed: ${err.message}`);
      sel.disabled = false;
    }
    return;
  }

  // Correct the applied date (e.g. you actually applied a few days ago).
  const dateInput = e.target.closest('input.age-date');
  if (dateInput) {
    const id = dateInput.dataset.id;
    const date = dateInput.value;
    if (!date) return; // cleared — leave the existing date untouched
    dateInput.disabled = true;
    try {
      await jsonPost(`/api/postings/${id}/applied-date`, { date });
      toast('Applied date updated');
      await reload();
    } catch (err) {
      toast(`Failed: ${err.message}`);
      dateInput.disabled = false;
    }
  }
});

// --- Init ---
(async function init() {
  try {
    CONFIG = await api('/api/config');
    SOURCE_LABEL = Object.fromEntries(CONFIG.sources.map((s) => [s.key, s.label]));
    SOURCE_CAREERS = Object.fromEntries(CONFIG.sources.map((s) => [s.key, s.careersUrl]));
    SOURCE_COOLDOWN = Object.fromEntries(CONFIG.sources.map((s) => [s.key, s.reapplyCooldownDays]));
    const sel = $('source');
    for (const s of CONFIG.sources) {
      const o = document.createElement('option');
      o.value = s.key; o.textContent = s.label; sel.appendChild(o);
    }
  } catch { /* config is best-effort; defaults already set */ }
  // Reflect the persisted layout choice on the toggle.
  for (const x of $('view-toggle').querySelectorAll('button')) x.classList.toggle('on', x.dataset.view === viewMode);
  await reload();
})();
