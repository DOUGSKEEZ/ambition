// Sniper review UI — vanilla JS, same-origin fetch.
const $ = (id) => document.getElementById(id);

// --- Theme + cross-app link (shared pattern with meddic) ---
(function initChrome() {
  const link = document.getElementById('cross-link');
  if (link) link.href = `${location.protocol}//${location.hostname}:7701/`; // -> meddic
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

let companies = [];
let current = null; // person being edited
let editingCompanyId = null; // company being edited (null = adding)

const EDIT_FIELDS = [
  'name', 'title', 'location', 'email', 'label', 'priority', 'company_id', 'type',
  'current_title', 'current_company', 'current_tenure',
  'previous_title', 'previous_company', 'about',
  'ai_summary', 'ai_ins', 'my_notes',
];

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), 2500);
}

function show(view) {
  for (const v of ['queue', 'detail', 'companies']) {
    $(`view-${v}`).classList.toggle('hidden', v !== view);
  }
  $('tab-queue').classList.toggle('active', view === 'queue');
  $('tab-companies').classList.toggle('active', view === 'companies');
  fitAll(); // textareas can't measure scrollHeight while hidden — fit once the view is visible
}

// Grow a textarea to fit its content (capped, then it scrolls). Manual resize via the
// handle still works; it just re-fits on the next keystroke.
function autosize(el) {
  if (!el || el.tagName !== 'TEXTAREA') return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight + 2, 600) + 'px';
}
function fitAll() {
  requestAnimationFrame(() => document.querySelectorAll('textarea').forEach(autosize));
}
// Auto-fit any textarea as the user types or pastes.
document.addEventListener('input', (e) => { if (e.target.tagName === 'TEXTAREA') autosize(e.target); });

function photoUrl(p) {
  return p.photo_path ? `/media/${p.photo_path}` : 'data:image/svg+xml;utf8,' +
    encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="%231f2430"/></svg>');
}

// ---------- Inline label/nickname editor (used in the queue table) ----------
// Returns a chip element; clicking it swaps in an input that PATCHes the label on
// Enter/blur (Escape cancels). Empty labels show a faint "+ label" affordance.
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
      try { await api(`/people/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: next || null }) }); toast('Label saved'); }
      catch (err) { toast(err.message); return input.replaceWith(makeNick(id, value)); }
      return input.replaceWith(makeNick(id, next));
    }
    input.replaceWith(makeNick(id, value)); // unchanged or cancelled
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

// ---------- Queue ----------
const PRIORITY_LABEL = { 1: 'High', 2: 'Medium', 3: 'Low' };

// Column sort state. Default matches the original behavior: priority ascending (High floats up).
// Headers are clickable to re-sort; clicking the active column flips direction.
let sortKey = 'priority';
let sortDir = 1; // 1 = ascending, -1 = descending
const SORT_ACCESSORS = {
  priority: (p) => p.priority ?? 99,                                  // nulls sort last
  name: (p) => (p.name || '').toLowerCase(),
  title: (p) => (p.title || '').toLowerCase(),
  company: (p) => (p.company_name || '').toLowerCase(),
  type: (p) => (p.type || '').toLowerCase(),
  captured: (p) => (p.captured_at ? new Date(p.captured_at).getTime() : 0),
};

// Sort in place by the active column, breaking ties by name so equal keys (e.g. same company)
// read predictably top-to-bottom.
function sortRows(rows) {
  const get = SORT_ACCESSORS[sortKey] || SORT_ACCESSORS.priority;
  const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
  rows.sort((a, b) => {
    const primary = cmp(get(a), get(b));
    if (primary) return primary * sortDir;
    if (sortKey === 'name') return 0;
    return cmp(SORT_ACCESSORS.name(a), SORT_ACCESSORS.name(b)) * sortDir;
  });
}

// Reflect the active column + direction in the header arrows.
function updateSortIndicators() {
  document.querySelectorAll('thead th[data-sort]').forEach((th) => {
    const active = th.dataset.sort === sortKey;
    th.classList.toggle('sorted', active);
    const arrow = th.querySelector('.sort-arrow');
    if (arrow) arrow.textContent = active ? (sortDir === 1 ? ' ▲' : ' ▼') : '';
  });
}
function priorityCell(p) {
  if (p.priority == null) return '<span class="muted">—</span>';
  return `<span class="badge p${p.priority}">${p.priority} · ${PRIORITY_LABEL[p.priority] || ''}</span>`;
}

async function loadQueue() {
  const status = $('status-filter').value;
  const priority = $('priority-filter').value;
  const qs = status ? `?import_status=${encodeURIComponent(status)}` : '';
  let rows = await api(`/people${qs}`);
  // Optionally narrow to a single priority, then order by the active column (priority by default).
  if (priority) rows = rows.filter((p) => p.priority === Number(priority));
  sortRows(rows);
  updateSortIndicators();
  const body = $('queue-body');
  body.innerHTML = '';
  $('queue-empty').classList.toggle('hidden', rows.length > 0);
  $('select-all').checked = false;
  for (const p of rows) {
    const tr = document.createElement('tr');
    const active = p.import_status === 'active';
    tr.innerHTML = `
      <td><input type="checkbox" class="row-check" value="${p.id}" ${active ? 'disabled title="active contacts cannot be deleted"' : ''}></td>
      <td><img class="thumb" src="${photoUrl(p)}" alt=""></td>
      <td>${priorityCell(p)}</td>
      <td class="name-cell">${esc(p.name)} </td>
      <td>${esc(p.title)}</td>
      <td>${esc(p.company_name)}</td>
      <td>${p.type ? `<span class="badge ${p.type}">${p.type}</span>` : ''}</td>
      <td class="muted">${p.captured_at ? new Date(p.captured_at).toLocaleString() : ''}</td>`;
    // Open detail on row click, except on the checkbox or the inline label editor.
    tr.onclick = (e) => { if (!e.target.closest('.row-check, .nick, .nick-input')) openDetail(p.id); };
    tr.querySelector('.row-check').onchange = updateBulkBar;
    tr.querySelector('.name-cell').appendChild(makeNick(p.id, p.label || ''));
    body.appendChild(tr);
  }
  updateBulkBar();
}

function selectedIds() {
  return [...document.querySelectorAll('.row-check:checked')].map((c) => Number(c.value));
}

function updateBulkBar() {
  const n = selectedIds().length;
  $('bulk-bar').classList.toggle('hidden', n === 0);
  $('bulk-count').textContent = n ? `${n} selected` : '';
}

async function bulkDelete() {
  const ids = selectedIds();
  if (!ids.length) return;
  if (!confirm(`Permanently delete ${ids.length} contact${ids.length > 1 ? 's' : ''}? This cannot be undone.`)) return;
  const r = await api('/people/bulk-delete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
  });
  const skipped = r.skipped_active?.length ? ` (${r.skipped_active.length} active skipped)` : '';
  toast(`Deleted ${r.deleted.length}${skipped}`);
  await loadQueue();
}

async function bulkColdStorage() {
  const ids = selectedIds();
  if (!ids.length) return;
  const r = await api('/people/bulk-cold-storage', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
  });
  toast(`Moved ${r.updated.length} to Cold Storage ❄️`);
  await loadQueue();
}

function esc(s) {
  return s == null ? '' : String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ---------- Detail ----------
async function openDetail(id) {
  current = await api(`/people/${id}`);
  populateCompanySelect($('f-company_id'), current.company_id);
  for (const f of EDIT_FIELDS) {
    const el = $(`f-${f}`);
    if (el) el.value = current[f] ?? '';
  }
  $('d-photo').src = current.photo_path ? `/media/${current.photo_path}` : photoUrl(current);
  $('d-slug').textContent = current.linkedin_url || current.linkedin_slug || '';
  // Show "Re-stage" only when this contact isn't currently staged (e.g. rejected/active),
  // so a rejected contact can be pulled back into the queue.
  $('d-restage').classList.toggle('hidden', current.import_status === 'staged');
  // Hide "Cold Storage" when the contact is already parked there.
  $('d-cold-storage').classList.toggle('hidden', current.import_status === 'cold_storage');
  // Delete is offered for any non-active contact (active would cascade-wipe outreach history).
  $('d-delete').classList.toggle('hidden', current.import_status === 'active');
  show('detail');
}

async function deleteCurrent() {
  if (!confirm(`Permanently delete ${current.name || 'this contact'}? This cannot be undone.`)) return;
  await api(`/people/${current.id}`, { method: 'DELETE' });
  toast('Deleted');
  show('queue');
  loadQueue();
}

function collectEdits() {
  const out = {};
  for (const f of EDIT_FIELDS) {
    const el = $(`f-${f}`);
    if (!el) continue;
    let v = el.value;
    if (v === '') v = null;
    if ((f === 'priority' || f === 'company_id') && v != null) v = Number(v);
    out[f] = v;
  }
  return out;
}

async function saveEdits() {
  current = await api(`/people/${current.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(collectEdits()),
  });
  toast('Saved');
}

async function regenerate() {
  // Persist current type first so regeneration respects a just-switched type.
  await saveEdits();
  toast('Regenerating…');
  current = await api(`/people/${current.id}/regenerate`, { method: 'POST' });
  $('f-ai_summary').value = current.ai_summary ?? '';
  $('f-ai_ins').value = current.ai_ins ?? '';
  autosize($('f-ai_summary')); autosize($('f-ai_ins')); // programmatic set fires no 'input' event
  toast('AI notes regenerated');
}

async function transition(action) {
  await saveEdits();
  await api(`/people/${current.id}/${action}`, { method: 'POST' });
  toast({ approve: 'Approved', reject: 'Rejected', restage: 'Re-staged', 'cold-storage': 'Moved to Cold Storage ❄️' }[action] || 'Updated');
  show('queue');
  loadQueue();
}

async function uploadPhoto() {
  const file = $('d-photo-file').files[0];
  if (!file) return toast('Choose a file first');
  const fd = new FormData();
  fd.append('photo', file);
  current = await api(`/people/${current.id}/photo`, { method: 'POST', body: fd });
  $('d-photo').src = `/media/${current.photo_path}?t=${Date.now()}`;
  toast('Photo updated');
}

// ---------- Companies ----------
async function loadCompanies() {
  companies = await api('/companies');
  const ul = $('companies-list');
  ul.innerHTML = '';
  for (const c of companies) {
    const li = document.createElement('li');
    // Cache-bust (?t) so an edited website's new favicon shows on re-render without a hard reload.
    li.innerHTML = `
      <img class="co-ico" src="/media/company-icons/${c.id}.png?t=${Date.now()}" alt="" onerror="this.style.visibility='hidden'">
      <div class="co-info">
        <div class="co-line"><strong>${esc(c.name)}</strong>${c.tier ? `<span class="tier-badge">${esc(c.tier)}</span>` : ''}</div>
        ${c.notes ? `<div class="co-notes muted">${esc(c.notes)}</div>` : ''}
      </div>
      <button class="co-edit">Edit</button>`;
    li.querySelector('.co-edit').onclick = () => beginEditCompany(c);
    ul.appendChild(li);
  }
}

function beginEditCompany(c) {
  editingCompanyId = c.id;
  $('c-name').value = c.name || '';
  $('c-tier').value = c.tier || '';
  $('c-notes').value = c.notes || '';
  $('c-website').value = c.website || '';
  $('c-add').textContent = 'Save changes';
  $('c-cancel').classList.remove('hidden');
  $('c-name').focus();
}

function cancelEditCompany() {
  editingCompanyId = null;
  $('c-name').value = $('c-tier').value = $('c-notes').value = $('c-website').value = '';
  $('c-add').textContent = 'Add company';
  $('c-cancel').classList.add('hidden');
}

function populateCompanySelect(sel, selectedId) {
  sel.innerHTML = '<option value="">— none —</option>';
  for (const c of companies) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    if (c.id === selectedId) opt.selected = true;
    sel.appendChild(opt);
  }
}

async function submitCompany() {
  const name = $('c-name').value.trim();
  if (!name) return toast('Name required');
  const body = JSON.stringify({
    name,
    tier: $('c-tier').value.trim() || null,
    notes: $('c-notes').value.trim() || null,
    website: $('c-website').value.trim() || null,
  });
  if (editingCompanyId) {
    await api(`/companies/${editingCompanyId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body,
    });
    toast('Company updated');
  } else {
    await api('/companies', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    });
    toast('Company added');
  }
  cancelEditCompany();
  await loadCompanies();
}

// ---------- Wire up ----------
$('tab-queue').onclick = () => { show('queue'); loadQueue(); };
$('tab-companies').onclick = () => { show('companies'); loadCompanies(); };
$('refresh-queue').onclick = loadQueue;
$('status-filter').onchange = loadQueue;
$('priority-filter').onchange = loadQueue;
// Clickable column headers: click to sort, click the active column again to flip direction.
// Text-ish columns start ascending (A→Z); Captured starts descending (newest first).
document.querySelectorAll('thead th[data-sort]').forEach((th) => {
  th.onclick = () => {
    const key = th.dataset.sort;
    if (sortKey === key) sortDir = -sortDir;
    else { sortKey = key; sortDir = key === 'captured' ? -1 : 1; }
    loadQueue();
  };
});
$('select-all').onchange = (e) => {
  document.querySelectorAll('.row-check:not(:disabled)').forEach((c) => { c.checked = e.target.checked; });
  updateBulkBar();
};
$('bulk-delete').onclick = () => bulkDelete().catch((err) => toast(err.message));
$('bulk-cold-storage').onclick = () => bulkColdStorage().catch((err) => toast(err.message));
$('back-to-queue').onclick = () => { show('queue'); loadQueue(); };
$('d-save').onclick = () => saveEdits().catch((e) => toast(e.message));
$('d-regenerate').onclick = () => regenerate().catch((e) => toast(e.message));
$('d-approve').onclick = () => transition('approve').catch((e) => toast(e.message));
$('d-reject').onclick = () => transition('reject').catch((e) => toast(e.message));
$('d-restage').onclick = () => transition('restage').catch((e) => toast(e.message));
$('d-cold-storage').onclick = () => transition('cold-storage').catch((e) => toast(e.message));
$('d-delete').onclick = () => deleteCurrent().catch((e) => toast(e.message));
$('d-photo-upload').onclick = () => uploadPhoto().catch((e) => toast(e.message));
$('c-add').onclick = () => submitCompany().catch((e) => toast(e.message));
$('c-cancel').onclick = cancelEditCompany;

// Boot
(async () => {
  await loadCompanies().catch(() => {});
  await loadQueue().catch((e) => toast(e.message));
  // Deep link: /?person=<id> opens that contact's detail directly (e.g. from meddic).
  const wanted = Number(new URLSearchParams(location.search).get('person'));
  if (wanted) await openDetail(wanted).catch((e) => toast(e.message));
})();
