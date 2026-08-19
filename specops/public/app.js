// specops SPA — vanilla JS. A Kanban board of opportunities; cards drag between stage columns.
const $ = (id) => document.getElementById(id);

// --- Theme + cross-app links (shared chrome) ---
(function initChrome() {
  const host = location.hostname;
  const sniper = $('link-sniper'); if (sniper) sniper.href = `${location.protocol}//${host}:7700/`;
  const medic = $('link-medic'); if (medic) medic.href = `${location.protocol}//${host}:7701/`;
  const eng = $('link-engineer'); if (eng) eng.href = `${location.protocol}//${host}:7702/`;
  const uav = $('link-uav'); if (uav) uav.href = `${location.protocol}//${host}:7704/`;
  const support = $('link-support'); if (support) support.href = `${location.protocol}//${host}:7707/`;
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
const jsonPut = (path, obj) => api(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
const jsonPost = (path, obj) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

const STAGES = [
  { key: 'lead', label: 'Pending Apply' },
  { key: 'outreach', label: 'Applied / Staged' },
  { key: 'outreach_today', label: 'Pending Draft' },
  { key: 'completed_outreach', label: 'Sent / Drafted' },
  { key: 'hm_reply', label: 'HM Reply' },
  { key: 'screen_interview', label: 'Screen & Interview' },
  { key: 'closed', label: 'Decision' },
];
const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.key, s.label]));
const OUTCOMES = ['accepted', 'rejected', 'withdrawn'];
// Card visual status (kept in lock-step with COLORS / STAMPS in routes/opportunities.js).
// accent_color is the "actively working this" cue; the stamp is a status emoji.
const CARD_COLORS = ['blue', 'red', 'green', 'orange'];
const STAMPS = ['🔥', '✅', '⚠️', '🥶', '📝', '🚀'];

function photoUrl(p) {
  return p && p.photo_path ? `/media/${p.photo_path}`
    : 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="%231f2430"/></svg>');
}
const typeBadge = (t) => (t ? `<span class="badge ${esc(t)}">${esc(t.replace('_', ' '))}</span>` : '');
// Deep link to a contact's detail in Medic (shared people table -> same id, new tab).
const medicLink = (pid) => `${location.protocol}//${location.hostname}:7701/?person=${pid}`;
// Default opportunity-contact role label per contact type (so it isn't retyped on attach).
const TYPE_ROLE = { hiring_manager: 'hiring manager', recruiter: 'recruiter', peer: 'peer' };
// Company favicon, served from Sniper's shared media (auto-fetched on company save in Sniper),
// keyed by company id so a rename can't break it. Hidden if that company has no icon.
const companyIcon = (id) => (id ? `<img class="co-ico" src="/media/company-icons/${id}.png" alt="" onerror="this.style.display='none'">` : '');

// --- state ---
let companies = [];
let companyId = 'all';
let opportunities = [];
let dividers = [];
const peopleCache = {}; // company_id -> people[]
let drag = null; // what's being dragged: { kind: 'opportunity' | 'divider', id }

// Per-card collapse state (ids of collapsed opportunities), persisted across reloads.
let collapsed = new Set();
try { collapsed = new Set(JSON.parse(localStorage.getItem('specops.collapsed') || '[]')); } catch { /* ignore */ }
const saveCollapsed = () => localStorage.setItem('specops.collapsed', JSON.stringify([...collapsed]));

const findOpp = (id) => opportunities.find((o) => o.id === id);
const findDivider = (id) => dividers.find((d) => d.id === id);

// ---------- bootstrap ----------
async function loadCompanies() {
  companies = await api('/companies');
  const sel = $('company');
  sel.innerHTML = '<option value="all">All companies</option>'
    + companies.map((c) => `<option value="${c.id}">${esc(c.name)} (${c.active_contacts})</option>`).join('');
  sel.value = 'all';
  updateCompanyIco();
}

// Show the selected company's favicon beside the picker (hidden for "All companies").
function updateCompanyIco() {
  const ico = $('company-ico');
  if (!ico) return;
  if (companyId === 'all') { ico.style.display = 'none'; return; }
  // Keep hidden until the new image actually loads, so switching to an iconless company
  // doesn't flash a broken-image before onerror fires.
  ico.style.display = 'none';
  ico.onload = () => { ico.style.display = ''; };
  ico.onerror = () => { ico.style.display = 'none'; };
  ico.src = `/media/company-icons/${companyId}.png`;
}

// Cache the in-flight promise (not just the result) so rapid opens coalesce into one request;
// drop the cache entry on failure so a transient error doesn't poison the picker until reload.
function peopleFor(cid) {
  if (!peopleCache[cid]) {
    peopleCache[cid] = api(`/people?company_id=${cid}`).catch((e) => { delete peopleCache[cid]; throw e; });
  }
  return peopleCache[cid];
}

// ---------- board ----------
async function loadBoard() {
  const path = companyId === 'all' ? '/opportunities' : `/opportunities?company_id=${companyId}`;
  // Dividers aren't company-scoped — they belong to a stage column and merge into it by sort_order.
  [opportunities, dividers] = await Promise.all([api(path), api('/dividers')]);
  renderBoard();
}

function renderBoard() {
  closePalette();     // the shared popovers are anchored to buttons this re-render replaces
  closeDivEditor();
  const board = $('board');
  // The board shows whenever there are cards OR dividers to place (a user can lay out dividers first).
  const empty = opportunities.length === 0 && dividers.length === 0;
  $('board-empty').classList.toggle('hidden', !empty);
  board.classList.toggle('hidden', empty);
  const open = opportunities.filter((o) => o.stage !== 'closed').length;
  $('board-note').textContent = opportunities.length ? `${opportunities.length} total · ${open} open` : '';

  board.innerHTML = STAGES.map((s) => {
    const inStage = opportunities.filter((o) => o.stage === s.key);
    // Cards and dividers share one sort_order space within the column, so merge and sort them together.
    const items = [
      ...inStage.map((o) => ({ kind: 'opportunity', so: o.sort_order, html: card(o) })),
      ...dividers.filter((d) => d.stage === s.key).map((d) => ({ kind: 'divider', so: d.sort_order, html: dividerEl(d) })),
    ].sort((a, b) => (a.so ?? Infinity) - (b.so ?? Infinity));
    // Column collapse-all toggle: if every card in the column is already collapsed, the button
    // expands them all; otherwise it collapses them all (so a mixed column collapses first).
    const allCollapsed = inStage.length > 0 && inStage.every((o) => collapsed.has(o.id));
    return `<div class="col ${s.key}" data-stage="${s.key}">
      <div class="col-head">
        <span class="name">${s.label}</span>
        <span class="count">${inStage.length}</span>
        <button class="col-collapse" data-col-collapse="${s.key}" title="${allCollapsed ? 'Expand all cards' : 'Collapse all cards'}"${inStage.length ? '' : ' disabled'}>${allCollapsed ? '▸' : '▾'}</button>
        <button class="col-add-divider" data-add-divider="${s.key}" title="Add a divider">⎯＋</button>
      </div>
      <div class="col-list">${items.map((it) => it.html).join('')}</div>
    </div>`;
  }).join('');

  wireBoard();
}

// A divider: a labeled separator that drops into a column between cards. It's a draggable board item
// (data-kind/data-item-id mirror the card's, so reorder treats them uniformly) with an edit handle.
function dividerEl(d) {
  const above = (d.label_above || d.chevron_up)
    ? `<div class="dv-cap dv-above">${d.chevron_up ? '<span class="dv-chev">⌃</span>' : ''}<span>${esc(d.label_above || '')}</span></div>`
    : '';
  const below = (d.label_below || d.chevron_down)
    ? `<div class="dv-cap dv-below"><span>${esc(d.label_below || '')}</span>${d.chevron_down ? '<span class="dv-chev">⌄</span>' : ''}</div>`
    : '';
  return `<div class="board-divider board-item" draggable="true" data-kind="divider" data-item-id="${d.id}" data-divider="${d.id}">
    ${above}
    <div class="dv-line"><button class="dv-edit" data-divider-edit="${d.id}" draggable="false" title="Edit divider">⋯</button></div>
    ${below}
  </div>`;
}

// The quick-status popover (color swatches + emoji stamps) is a SINGLE element appended to <body>
// with position:fixed, not one-per-card inside the cards. That keeps it from being clipped by a
// column's overflow scroll box, and keeps its buttons out of the draggable card subtree (so a
// fumbled click can't start a card drag). It's positioned next to the 🎨 button that opened it.
let paletteEl = null;     // the shared popover (lazily created)
let paletteOppId = null;  // which opportunity it's currently showing, or null when hidden

function closePalette() { if (paletteEl) paletteEl.classList.add('hidden'); paletteOppId = null; }

function openPalette(btn, o) {
  if (!paletteEl) {
    paletteEl = document.createElement('div');
    paletteEl.className = 'card-palette hidden';
    paletteEl.addEventListener('click', (e) => e.stopPropagation()); // clicks inside don't close it / open detail
    document.body.appendChild(paletteEl);
  }
  paletteOppId = o.id;
  const colorBtns = [`<button class="cp-color cp-none${o.accent_color ? '' : ' on'}" data-color="" title="No color">∅</button>`]
    .concat(CARD_COLORS.map((c) => `<button class="cp-color ${c}${o.accent_color === c ? ' on' : ''}" data-color="${c}" title="${c}"></button>`)).join('');
  const stampBtns = [`<button class="cp-stamp cp-none${o.stamp ? '' : ' on'}" data-stamp="" title="No stamp">∅</button>`]
    .concat(STAMPS.map((s) => `<button class="cp-stamp${o.stamp === s ? ' on' : ''}" data-stamp="${esc(s)}">${esc(s)}</button>`)).join('');
  paletteEl.innerHTML = `<div class="cp-row">${colorBtns}</div><div class="cp-row">${stampBtns}</div>`;
  const apply = async (patch) => {
    closePalette();
    try { await jsonPut(`/opportunities/${o.id}`, patch); await loadBoard(); }
    catch (err) { toast(err.message); }
  };
  paletteEl.querySelectorAll('[data-color]').forEach((b) => { b.onclick = () => apply({ accent_color: b.dataset.color || null }); });
  paletteEl.querySelectorAll('[data-stamp]').forEach((b) => { b.onclick = () => apply({ stamp: b.dataset.stamp || null }); });
  // Show first (so we can measure it), then anchor under the button, flipping up/left to stay on-screen.
  paletteEl.classList.remove('hidden');
  const r = btn.getBoundingClientRect();
  const p = paletteEl.getBoundingClientRect();
  let top = r.bottom + 6;
  if (top + p.height > window.innerHeight - 8) top = Math.max(8, r.top - p.height - 6);
  let left = Math.min(r.right - p.width, window.innerWidth - 8 - p.width);
  if (left < 8) left = 8;
  paletteEl.style.top = `${top}px`;
  paletteEl.style.left = `${left}px`;
}

// Anchor a fixed-position popover under `btn`, flipping up/left to stay on-screen. Shared by the
// divider editor; the palette has its own copy.
function anchorTo(el, btn) {
  const r = btn.getBoundingClientRect();
  const p = el.getBoundingClientRect();
  let top = r.bottom + 6;
  if (top + p.height > window.innerHeight - 8) top = Math.max(8, r.top - p.height - 6);
  let left = Math.min(r.right - p.width, window.innerWidth - 8 - p.width);
  if (left < 8) left = 8;
  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
}

// ---- divider editor ----
// A single shared popover (like the palette) for editing a divider's captions + chevrons. Lives on
// <body> so a column's scroll box can't clip it, and stops its own clicks from bubbling to close.
let divEditorEl = null;
let divEditorId = null;
function closeDivEditor() { if (divEditorEl) divEditorEl.classList.add('hidden'); divEditorId = null; }
function openDivEditor(btn, d) {
  if (!divEditorEl) {
    divEditorEl = document.createElement('div');
    divEditorEl.className = 'div-editor hidden';
    divEditorEl.addEventListener('click', (e) => e.stopPropagation());
    document.body.appendChild(divEditorEl);
  }
  divEditorId = d.id;
  divEditorEl.innerHTML = `
    <label class="de-field">Text above<input class="de-above" type="text" value="${esc(d.label_above || '')}" placeholder="e.g. Today"></label>
    <label class="de-field">Text below<input class="de-below" type="text" value="${esc(d.label_below || '')}" placeholder="e.g. Tomorrow"></label>
    <div class="de-chevs">
      <button type="button" class="de-chev de-up${d.chevron_up ? ' on' : ''}">⌃ up</button>
      <button type="button" class="de-chev de-down${d.chevron_down ? ' on' : ''}">⌄ down</button>
    </div>
    <div class="de-actions">
      <button class="primary sm de-save">Save</button>
      <span class="spacer"></span>
      <button class="bad sm de-remove">Remove</button>
    </div>`;
  const up = divEditorEl.querySelector('.de-up');
  const down = divEditorEl.querySelector('.de-down');
  up.onclick = () => up.classList.toggle('on');
  down.onclick = () => down.classList.toggle('on');
  divEditorEl.querySelector('.de-save').onclick = async () => {
    const patch = {
      label_above: divEditorEl.querySelector('.de-above').value.trim() || null,
      label_below: divEditorEl.querySelector('.de-below').value.trim() || null,
      chevron_up: up.classList.contains('on'),
      chevron_down: down.classList.contains('on'),
    };
    closeDivEditor();
    try { await jsonPut(`/dividers/${d.id}`, patch); await loadBoard(); }
    catch (err) { toast(err.message); }
  };
  divEditorEl.querySelector('.de-remove').onclick = async () => {
    closeDivEditor();
    try { await api(`/dividers/${d.id}`, { method: 'DELETE' }); await loadBoard(); }
    catch (err) { toast(err.message); }
  };
  divEditorEl.classList.remove('hidden');
  anchorTo(divEditorEl, btn);
}

function card(o) {
  const isCol = collapsed.has(o.id);
  const accent = o.accent_color ? ` accent-${o.accent_color}` : '';
  const outcome = o.stage === 'closed' && o.outcome ? `<span class="badge outcome">${esc(o.outcome)}</span>` : '';
  // The linked UAV posting has closed — a soft rejection. Flagged on the card (any stage but
  // Decision) so notes can be added before moving it to the Closed/Decision column by hand.
  const postingClosed = o.job_posting_closed_at && o.stage !== 'closed'
    ? '<span class="badge posting-closed" title="The linked UAV job posting has closed — soft rejection. Add notes, then move the card to Decision.">⛔️ posting closed</span>' : '';
  const stamp = o.stamp ? `<span class="oc-stamp">${esc(o.stamp)}</span>` : '';
  // Header is always shown (company + title, stamp, paint + collapse controls); the body is hidden when collapsed.
  const head = `<div class="oc-head">
    <div class="oc-titles">
      <div class="oc-company">${companyIcon(o.company_id)}${esc(o.company_name)} ${outcome}${postingClosed}</div>
      <div class="oc-role">${o.role_title ? esc(o.role_title) : '<span class="muted">untitled role</span>'}</div>
    </div>
    ${stamp}
    <button class="oc-paint" data-paint="${o.id}" draggable="false" title="Color &amp; stamp">●</button>
    <button class="oc-collapse" data-collapse="${o.id}" title="${isCol ? 'Expand' : 'Collapse'}">${isCol ? '▸' : '▾'}</button>
  </div>`;
  if (isCol) return `<div class="opp-card collapsed board-item${accent}" draggable="true" data-kind="opportunity" data-item-id="${o.id}" data-id="${o.id}">${head}</div>`;

  const primary = (o.contacts || []).find((c) => c.is_primary) || (o.contacts || [])[0];
  const meta = [o.comp_range, o.location].filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join('');
  const extra = (o.contacts || []).length > 1 ? `<span class="muted" style="font-size:11px">+${o.contacts.length - 1}</span>` : '';
  const contactBit = primary
    ? `<div class="oc-contacts"><img class="thumb sm" src="${photoUrl(primary)}" title="${esc(primary.name)}"> <span style="font-size:12px">${esc(primary.name)}</span> ${extra}</div>`
    : '<div class="oc-contacts muted" style="font-size:12px">no contact yet</div>';
  return `<div class="opp-card board-item${accent}" draggable="true" data-kind="opportunity" data-item-id="${o.id}" data-id="${o.id}">
    ${head}
    ${meta ? `<div class="oc-meta">${meta}</div>` : ''}
    ${contactBit}
  </div>`;
}

// A single shared insertion line, moved between columns as you drag (so there's never more than
// one). markerRef reports which board item (card OR divider) the cursor sits above — its midpoint
// decides above/below — or null to drop at the end of the column.
let dropMarker = null;
function ensureMarker() {
  if (!dropMarker) { dropMarker = document.createElement('div'); dropMarker.className = 'drop-marker'; }
  return dropMarker;
}
function clearMarker() { if (dropMarker?.parentNode) dropMarker.remove(); }
// {kind, id} for a board item element (a card or a divider). reorder treats both uniformly.
const elItem = (el) => ({ kind: el.dataset.kind, id: Number(el.dataset.itemId) });
const sameOrder = (a, b) => a.length === b.length && a.every((x, i) => x.kind === b[i].kind && x.id === b[i].id);
function markerRef(colList, clientY) {
  const items = [...colList.querySelectorAll('.board-item:not(.dragging)')];
  for (const el of items) {
    const r = el.getBoundingClientRect();
    if (clientY < r.top + r.height / 2) return el;
  }
  return null;
}

function wireBoard() {
  const board = $('board');
  // Cards and dividers are both draggable board items; the card alone opens its detail on click.
  board.querySelectorAll('.board-item').forEach((el) => {
    el.addEventListener('dragstart', (e) => { drag = elItem(el); el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
    el.addEventListener('dragend', () => { el.classList.remove('dragging'); drag = null; clearMarker(); });
  });
  board.querySelectorAll('.opp-card').forEach((el) => {
    el.addEventListener('click', () => { const o = findOpp(Number(el.dataset.id)); if (o) openDetail(o); });
  });
  // Divider edit handle: opens the caption/chevron editor popover (stopPropagation so it doesn't
  // start a drag-adjacent click or hit the document-level close handler).
  board.querySelectorAll('[data-divider-edit]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const d = findDivider(Number(el.dataset.dividerEdit));
      if (!d) return;
      if (divEditorId === d.id && divEditorEl && !divEditorEl.classList.contains('hidden')) closeDivEditor();
      else openDivEditor(el, d);
    });
  });
  // Column header "+ divider": drop a fresh divider at the top of that stage to drag into place.
  board.querySelectorAll('[data-add-divider]').forEach((el) => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      try { await jsonPost('/dividers', { stage: el.dataset.addDivider }); await loadBoard(); }
      catch (err) { toast(err.message); }
    });
  });
  // Column header collapse-all: collapse every card in the stage, or expand them if all are already collapsed.
  board.querySelectorAll('[data-col-collapse]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const ids = opportunities.filter((o) => o.stage === el.dataset.colCollapse).map((o) => o.id);
      const allCollapsed = ids.length > 0 && ids.every((id) => collapsed.has(id));
      if (allCollapsed) ids.forEach((id) => collapsed.delete(id));
      else ids.forEach((id) => collapsed.add(id));
      saveCollapsed();
      renderBoard();
    });
  });
  // Collapse/expand chevron — toggles the card without opening the detail.
  board.querySelectorAll('[data-collapse]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = Number(el.dataset.collapse);
      if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
      saveCollapsed();
      renderBoard();
    });
  });
  // 🎨 quick-status: the paint button opens the shared color/stamp popover next to it (toggling if it's
  // already this card's). stopPropagation keeps the click from opening the detail modal or hitting the
  // document-level "close palette" handler. The popover itself lives on <body> (see openPalette).
  board.querySelectorAll('[data-paint]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const o = findOpp(Number(el.dataset.paint));
      if (!o) return;
      if (paletteOppId === o.id && paletteEl && !paletteEl.classList.contains('hidden')) closePalette();
      else openPalette(el, o);
    });
  });
  board.querySelectorAll('.col').forEach((col) => {
    const colList = col.querySelector('.col-list');
    col.addEventListener('dragover', (e) => {
      e.preventDefault();
      col.classList.add('drag-over');
      // Park the insertion line at the cursor position so the drop target is visible.
      const marker = ensureMarker();
      colList.insertBefore(marker, markerRef(colList, e.clientY));
    });
    col.addEventListener('dragleave', (e) => {
      // Only react when the pointer actually leaves the column (dragleave also fires when moving
      // onto a child); the marker itself is cleared on drop/dragend.
      if (!col.contains(e.relatedTarget)) col.classList.remove('drag-over');
    });
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const dropped = drag;          // {kind, id} captured at dragstart
      clearMarker();
      if (!dropped) return;
      const stage = col.dataset.stage;
      // New top-to-bottom order for this column: the items already here (minus the dragged one),
      // with the dragged item spliced in where the marker sat. Cards and dividers ride together.
      const ref = markerRef(colList, e.clientY);
      const order = [...colList.querySelectorAll('.board-item:not(.dragging)')].map(elItem);
      const at = ref ? order.findIndex((it) => it.kind === ref.dataset.kind && it.id === Number(ref.dataset.itemId)) : -1;
      order.splice(at < 0 ? order.length : at, 0, dropped);
      // No-op guard: dropped back into its own column in the same position. `before` includes the
      // dragged element at its original slot (only present when it started in this column).
      const before = [...colList.querySelectorAll('.board-item')].map(elItem);
      const fromStage = (dropped.kind === 'divider' ? findDivider(dropped.id) : findOpp(dropped.id))?.stage;
      if (fromStage === stage && sameOrder(before, order)) return;
      // Wire format: the reorder endpoint keys items by `type` (not our internal `kind`).
      const items = order.map((it) => ({ type: it.kind, id: it.id }));
      try { await jsonPut('/opportunities/reorder', { stage, items }); await loadBoard(); }
      catch (err) { toast(err.message); }
    });
  });
}

// ---------- modal ----------
function openModal() { $('modal').classList.remove('hidden'); }
function closeModal() { $('modal').classList.add('hidden'); $('modal-body').innerHTML = ''; $('modal-body').classList.remove('two-col'); }
$('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (paletteOppId !== null) closePalette();       // Escape closes the quick-status popover first…
  else if (divEditorId !== null) closeDivEditor();  // …then the divider editor…
  else if (!$('modal').classList.contains('hidden')) closeModal();  // …then the modal
});
// Both body-level popovers are fixed-positioned next to their button, so close them on any outside
// click (their own clicks + the trigger button stopPropagation) and whenever the page/columns scroll
// or resize (capture:true catches column scrolls, which don't bubble) so they never drift off-anchor.
const closePopovers = () => { closePalette(); closeDivEditor(); };
document.addEventListener('click', closePopovers);
window.addEventListener('scroll', closePopovers, true);
window.addEventListener('resize', closePopovers);

const stageOptions = (sel) => STAGES.map((s) => `<option value="${s.key}"${s.key === sel ? ' selected' : ''}>${s.label}</option>`).join('');

// ---- create ----
// openCreate(prefill?) — prefill is set when arriving from a UAV "Send to SpecOps" deep link:
// { company_id, role_title, job_posting_url, location, job_posting_id }. The company is preselected
// and the form pre-filled for review; job_posting_id rides along to record the link on Create.
function openCreate(prefill) {
  if (!companies.length) { toast('Add a company in Sniper first'); return; }
  const coOpts = companies.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  $('modal-body').classList.remove('two-col');
  $('modal-body').innerHTML = `
    <h2>New opportunity</h2>
    <div class="sub">A role you're pursuing. Company is required; everything else is optional and editable later.</div>
    <div class="field"><label>Company *</label><select data-f="company_id">${coOpts}</select></div>
    <div class="field"><label>Role title</label><input data-f="role_title" type="text" placeholder="e.g. Sr Enterprise AE (placeholder is fine)"></div>
    <div class="field"><label>Job posting URL</label><input data-f="job_posting_url" type="url" placeholder="(optional — many roles aren't listed)"></div>
    <div class="row2">
      <div class="field"><label>Comp range</label><input data-f="comp_range" type="text" placeholder="$220–260k"></div>
      <div class="field"><label>Location</label><input data-f="location" type="text" placeholder="SF / NY / Remote"></div>
    </div>
    <div class="field"><label>Stage</label><select data-f="stage">${stageOptions('lead')}</select></div>
    <div class="modal-actions">
      <button class="primary" id="m-create">Create</button>
      <span class="spacer"></span>
      <button id="m-cancel">Cancel</button>
    </div>`;
  const body = $('modal-body');
  const setF = (f, v) => { const el = body.querySelector(`[data-f="${f}"]`); if (el != null && v != null) el.value = v; };
  if (prefill) {
    // From a UAV deep link: company comes resolved to an id; pre-fill the rest for review.
    setF('company_id', String(prefill.company_id));
    setF('role_title', prefill.role_title);
    setF('job_posting_url', prefill.job_posting_url);
    setF('location', prefill.location);
  } else if (companyId !== 'all') {
    // Otherwise pre-select the company the board is currently filtered to, if any.
    setF('company_id', String(companyId));
  }
  $('m-cancel').onclick = closeModal;
  $('m-create').onclick = async () => {
    const payload = collect(body);
    payload.company_id = Number(payload.company_id);
    if (prefill?.job_posting_id != null) payload.job_posting_id = prefill.job_posting_id;
    try {
      const created = await jsonPost('/opportunities', payload);
      await loadBoard();
      openDetail(created); // straight into detail to add HM contacts
    } catch (e) { toast(e.message); }
  };
  openModal();
}

// ---- detail / edit ----
async function openDetail(opp) {
  openModal();
  await renderDetail(opp);
}

async function renderDetail(o) {
  const people = await peopleFor(o.company_id).catch(() => []);
  const attachedIds = new Set((o.contacts || []).map((c) => c.person_id));
  const addable = people.filter((p) => !attachedIds.has(p.id));
  const primary = (o.contacts || []).find((c) => c.is_primary) || (o.contacts || [])[0];
  const outcomeOpts = ['<option value="">—</option>'].concat(OUTCOMES.map((x) => `<option value="${x}"${x === o.outcome ? ' selected' : ''}>${x}</option>`)).join('');
  const personLabel = (p) => `${p.name}${p.title ? ' — ' + p.title : ''}`;

  $('modal-body').classList.add('two-col');
  $('modal-body').innerHTML = `
    <h2>${companyIcon(o.company_id)}${esc(o.company_name)}</h2>
    <div class="sub">${o.role_title ? esc(o.role_title) : 'untitled role'} · ${STAGE_LABEL[o.stage]}</div>

    <div class="mcol">
      <div class="field"><label>Company *</label><select data-f="company_id">${companies.map((c) => `<option value="${c.id}"${c.id === o.company_id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Role title</label><input data-f="role_title" type="text" value="${esc(o.role_title)}" placeholder="placeholder is fine"></div>
      <div class="field"><label>Job posting URL</label><input data-f="job_posting_url" type="url" value="${esc(o.job_posting_url)}" placeholder="(optional — many roles aren't listed)"></div>
      <div class="field">
        <label>Linked UAV posting <span class="muted" style="text-transform:none;letter-spacing:0">· the radar role this tracks</span></label>
        ${o.job_posting_id ? `<div class="linked-posting">
            <span class="lp-info">🛰 ${esc(o.job_posting_title || ('posting #' + o.job_posting_id))}${o.job_posting_closed_at ? ' · closed' : ''}</span>
            ${o.job_posting_link ? `<a class="link" href="${esc(o.job_posting_link)}" target="_blank" rel="noopener">↗</a>` : ''}
            <span class="spacer"></span>
            <button class="sm ghost" id="lp-clear" type="button">Clear</button>
          </div>`
        : `<div class="linked-posting" id="lp-picker"><button class="sm" id="lp-link" type="button">＋ Link a UAV posting</button></div>`}
      </div>
      <div class="row2">
        <div class="field"><label>Comp range</label><input data-f="comp_range" type="text" value="${esc(o.comp_range)}"></div>
        <div class="field"><label>Location</label><input data-f="location" type="text" value="${esc(o.location)}"></div>
      </div>
      <div class="row2">
        <div class="field"><label>Stage</label><select data-f="stage">${stageOptions(o.stage)}</select></div>
        <div class="field">
          <label>First message <span class="muted" style="text-transform:none;letter-spacing:0">· to the primary HM</span></label>
          <div class="fm-row">
            <input data-f="first_message_at" type="date" value="${esc(o.first_message_at)}">
            <button class="sm" id="import-fm" type="button" title="Pull the date + text of your first Medic message to the primary HM">↓ Import</button>
          </div>
        </div>
      </div>
      <div id="fm-preview" class="fm-preview hidden"></div>

      <div class="field">
        <label>Card status <span class="muted" style="text-transform:none;letter-spacing:0">· a color marks it active; add a stamp</span></label>
        <input type="hidden" data-f="accent_color" value="${esc(o.accent_color || '')}">
        <input type="hidden" data-f="stamp" value="${esc(o.stamp || '')}">
        <div class="status-pick">
          <div class="sp-row" id="sp-colors">
            <button type="button" class="cp-color cp-none${o.accent_color ? '' : ' on'}" data-color="" title="No color">∅</button>
            ${CARD_COLORS.map((c) => `<button type="button" class="cp-color ${c}${o.accent_color === c ? ' on' : ''}" data-color="${c}" title="${c}"></button>`).join('')}
          </div>
          <div class="sp-row" id="sp-stamps">
            <button type="button" class="cp-stamp cp-none${o.stamp ? '' : ' on'}" data-stamp="" title="No stamp">∅</button>
            ${STAMPS.map((s) => `<button type="button" class="cp-stamp${o.stamp === s ? ' on' : ''}" data-stamp="${esc(s)}">${esc(s)}</button>`).join('')}
          </div>
        </div>
      </div>

      <div class="field"><label>Opportunity notes</label><textarea data-f="notes" placeholder="Prep, threads, interview context…">${esc(o.notes)}</textarea></div>

      <div class="field">
        <label>Target contacts (HMs — guessing is fine)</label>
        <div class="contacts-list" id="contacts-list">
          ${(o.contacts || []).length ? o.contacts.map(contactRow).join('') : '<span class="muted" style="font-size:13px">No contacts attached yet.</span>'}
        </div>
        <div class="add-contact">
          <input id="add-person" list="people-dl" placeholder="${addable.length ? 'Search a contact to add…' : '(no more contacts for this company)'}" autocomplete="off"${addable.length ? '' : ' disabled'}>
          <datalist id="people-dl">${addable.map((p) => `<option value="${esc(personLabel(p))}"></option>`).join('')}</datalist>
          <button class="sm" id="add-contact-btn"${addable.length ? '' : ' disabled'}>+ Add</button>
        </div>
      </div>
    </div>

    <div class="mcol">
      ${primary ? `<div class="field">
        <label>Primary HM notes — ${esc(primary.name)} <span class="muted" style="text-transform:none;letter-spacing:0">· from Medic, read-only</span></label>
        <div class="hm-notes">
          ${primary.my_notes ? `<div class="note-block">${esc(primary.my_notes)}</div>` : ''}
          ${primary.ai_summary ? `<div class="note-block ai"><span class="muted">AI summary</span>\n${esc(primary.ai_summary)}</div>` : ''}
          ${(!primary.my_notes && !primary.ai_summary) ? '<span class="muted" style="font-size:13px">No notes on this contact yet — add them in Medic.</span>' : ''}
          <a class="link" href="${medicLink(primary.person_id)}" target="_blank" rel="noopener"><img class="ic14" src="icons/meddic-20.png" alt=""> Edit in Meddic ↗</a>
        </div>
      </div>` : '<div class="field"><label>Primary HM notes</label><div class="hm-notes muted" style="font-size:13px">Attach a primary HM (left) and their Medic notes show here.</div></div>'}
    </div>

    <div class="modal-actions">
      <button class="primary" id="m-save">Save</button>
      <button id="m-close">Close</button>
      <span class="spacer"></span>
      <label class="footer-outcome">Outcome <select data-f="outcome">${outcomeOpts}</select></label>
      <button class="bad sm" id="m-delete">Delete</button>
    </div>`;

  // contact row actions
  $('contacts-list').querySelectorAll('[data-remove]').forEach((el) => {
    el.onclick = async () => {
      const c = (o.contacts || []).find((x) => String(x.person_id) === el.dataset.remove);
      if (!confirm(`Remove ${c?.name || 'this contact'} from this opportunity?\n\nThe contact itself stays in Sniper/Meddic — this only unlinks them here.`)) return;
      try { const upd = await api(`/opportunities/${o.id}/contacts/${el.dataset.remove}`, { method: 'DELETE' }); await renderDetail(upd); refreshUnder(); } catch (e) { toast(e.message); }
    };
  });
  $('contacts-list').querySelectorAll('[data-primary]').forEach((el) => {
    el.onclick = async () => {
      const c = (o.contacts || []).find((x) => String(x.person_id) === el.dataset.primary);
      try { const upd = await jsonPost(`/opportunities/${o.id}/contacts`, { person_id: Number(el.dataset.primary), role: c?.role || null, is_primary: true }); await renderDetail(upd); refreshUnder(); } catch (e) { toast(e.message); }
    };
  });
  $('add-contact-btn').onclick = async () => {
    const val = $('add-person').value.trim();
    if (!val) return;
    // Map the typed/selected search text back to a contact (exact label, else exact name).
    const person = addable.find((p) => personLabel(p) === val) || addable.find((p) => p.name === val);
    if (!person) { toast('Pick a contact from the list'); return; }
    // Default the contact's role label from their contact type, not a hardcoded "hiring manager".
    const role = TYPE_ROLE[person.type] || null;
    const makePrimary = !(o.contacts || []).some((c) => c.is_primary); // first contact becomes primary
    try { const upd = await jsonPost(`/opportunities/${o.id}/contacts`, { person_id: person.id, role, is_primary: makePrimary }); await renderDetail(upd); refreshUnder(); } catch (e) { toast(e.message); }
  };
  // Import the first Medic message to the primary HM: fills the date + shows the message text.
  $('import-fm')?.addEventListener('click', async () => {
    try {
      const msg = await api(`/opportunities/${o.id}/first-message`);
      if (!msg) { toast(primary ? 'No sent message found for the primary HM' : 'Set a primary HM first'); return; }
      const inp = $('modal-body').querySelector('[data-f="first_message_at"]');
      if (inp) inp.value = msg.date;
      const prev = $('fm-preview');
      prev.classList.remove('hidden');
      prev.innerHTML = `<div class="muted">${esc(msg.date)} · ${esc(msg.channel || 'message')} → ${esc(msg.contact_name || '')} <span style="font-style:italic">(date filled — click Save to keep)</span></div>${esc(msg.text || '')}`;
    } catch (e) { toast(e.message); }
  });

  // Linked UAV posting: link/clear persist immediately (like contact actions), then re-render.
  $('lp-clear')?.addEventListener('click', async () => {
    try { const upd = await jsonPut(`/opportunities/${o.id}`, { job_posting_id: null }); await renderDetail(upd); refreshUnder(); }
    catch (e) { toast(e.message); }
  });
  $('lp-link')?.addEventListener('click', async () => {
    try {
      const list = await api(`/job-postings?company_id=${o.company_id}`);
      const picker = $('lp-picker');
      if (!list.length) { picker.innerHTML = '<span class="muted" style="font-size:13px">No open, unlinked UAV postings for this company.</span>'; return; }
      picker.innerHTML = `<select id="lp-select"><option value="">Pick a posting…</option>${list.map((j) => `<option value="${j.id}">${esc(j.title)}${j.location ? ' — ' + esc(j.location) : ''}</option>`).join('')}</select>`;
      $('lp-select').onchange = async (e) => {
        const id = Number(e.target.value);
        if (!id) return;
        try { const upd = await jsonPut(`/opportunities/${o.id}`, { job_posting_id: id }); await renderDetail(upd); refreshUnder(); }
        catch (err) { toast(err.message); }
      };
    } catch (e) { toast(e.message); }
  });

  // Card status picker: clicking a swatch/stamp updates its hidden [data-f] input (so it saves with
  // the rest of the form via collect) and moves the active highlight. '' clears the color/stamp.
  const wirePick = (rowId, field) => {
    const input = $('modal-body').querySelector(`[data-f="${field}"]`);
    const row = $(rowId);
    const attr = field === 'accent_color' ? 'color' : 'stamp';
    row.querySelectorAll(`[data-${attr}]`).forEach((b) => {
      b.onclick = () => {
        input.value = b.dataset[attr];
        row.querySelectorAll(`[data-${attr}]`).forEach((x) => x.classList.toggle('on', x === b));
      };
    });
  };
  wirePick('sp-colors', 'accent_color');
  wirePick('sp-stamps', 'stamp');

  $('m-close').onclick = closeModal;
  $('m-save').onclick = async () => {
    const payload = collect($('modal-body'));
    // Moving the opportunity to a different company unlinks contacts from the old company (they're
    // company-scoped). Warn before that happens so it isn't a silent surprise.
    if (Number(payload.company_id) !== o.company_id && (o.contacts || []).length
        && !confirm('Change company? Contacts attached from the current company will be unlinked (the people themselves stay in Sniper/Meddic).')) return;
    try { await jsonPut(`/opportunities/${o.id}`, payload); closeModal(); await loadBoard(); }
    catch (e) { toast(e.message); }
  };
  $('m-delete').onclick = async () => {
    if (!confirm('Delete this opportunity? Its contact links are removed too (the people themselves are kept).')) return;
    try { await api(`/opportunities/${o.id}`, { method: 'DELETE' }); closeModal(); await loadBoard(); }
    catch (e) { toast(e.message); }
  };
}

function contactRow(c) {
  return `<div class="contact-row">
    <img class="thumb" src="${photoUrl(c)}">
    <div>
      <div class="cr-name">${esc(c.name)} ${c.is_primary ? '<span class="badge primary">★ primary</span>' : ''}</div>
      <div class="cr-title">${typeBadge(c.type)}${(c.role && c.role !== TYPE_ROLE[c.type]) ? ' ' + esc(c.role) : ''}${c.title ? ' · ' + esc(c.title) : ''}</div>
    </div>
    <span class="spacer"></span>
    ${c.is_primary ? '' : `<a class="link" data-primary="${c.person_id}">make primary</a>`}
    <a class="link medic-link" href="${medicLink(c.person_id)}" target="_blank" rel="noopener" title="Open in Meddic"><span class="ml-top"><img class="ic14" src="icons/meddic-20.png" alt="">↗</span><span class="ml-label">Meddic</span></a>
    <a class="link" data-remove="${c.person_id}">remove</a>
  </div>`;
}

// Collect [data-f] field values within a root into a payload object.
function collect(root) {
  const out = {};
  root.querySelectorAll('[data-f]').forEach((el) => { out[el.dataset.f] = el.value; });
  return out;
}

// After a contact mutation (which doesn't close the modal), refresh the board underneath so
// the card's contact summary stays in sync.
function refreshUnder() { loadBoard().catch((e) => toast(e.message)); }

// ---------- wiring ----------
$('new-opp').onclick = () => openCreate(); // no arg — the click event must not become `prefill`
$('company').onchange = (e) => { companyId = e.target.value === 'all' ? 'all' : Number(e.target.value); updateCompanyIco(); loadBoard().catch((err) => toast(err.message)); };

(async function init() {
  try {
    await loadCompanies();
    const qs = new URLSearchParams(location.search);

    // View deep link from UAV (a linked posting's badge): ?company_id=<id> → preselect the filter.
    const viewId = Number.parseInt(qs.get('company_id'), 10);
    if (Number.isInteger(viewId) && companies.some((c) => c.id === viewId)) {
      companyId = viewId; $('company').value = String(viewId); updateCompanyIco();
    }

    await loadBoard();

    // Create deep link from UAV "Send to SpecOps":
    // ?newOpp=1&company=<name>&role_title&job_posting_url&location&job_posting_id
    if (qs.get('newOpp')) {
      const name = (qs.get('company') || '').trim();
      const co = companies.find((c) => c.name.toLowerCase() === name.toLowerCase());
      if (!co) {
        toast(`Add '${name}' in Sniper first`);
      } else {
        openCreate({
          company_id: co.id,
          role_title: qs.get('role_title') || '',
          job_posting_url: qs.get('job_posting_url') || '',
          location: qs.get('location') || '',
          job_posting_id: Number.parseInt(qs.get('job_posting_id'), 10) || null,
        });
      }
    }

    // Strip the params so a refresh doesn't re-trigger the modal/filter (suite pattern).
    if ([...qs.keys()].length) history.replaceState(null, '', location.pathname);
  } catch (e) { toast(e.message); }
})();
