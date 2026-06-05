// meddic SPA — vanilla JS, same-origin fetch.
const $ = (id) => document.getElementById(id);

// --- Theme + cross-app link (shared pattern with sniper) ---
(function initChrome() {
  const link = document.getElementById('cross-link');
  if (link) link.href = `${location.protocol}//${location.hostname}:7700/`; // -> sniper
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
function show(view) {
  for (const v of ['today', 'roster', 'person', 'campaigns', 'campaign-edit']) {
    $(`view-${v}`).classList.toggle('hidden', v !== view);
  }
  $('tab-today').classList.toggle('active', view === 'today');
  $('tab-roster').classList.toggle('active', view === 'roster');
  $('tab-campaigns').classList.toggle('active', view === 'campaigns' || view === 'campaign-edit');
  fitAll(); // textareas can't measure scrollHeight while hidden — fit once the view is visible
}

// Grow a textarea to fit its content (capped, then it scrolls). Manual resize still works;
// it just re-fits on the next keystroke.
function autosize(el) {
  if (!el || el.tagName !== 'TEXTAREA') return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight + 2, 600) + 'px';
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
function typeBadge(t) { return t ? `<span class="badge ${t}">${t.replace('_', ' ')}</span>` : ''; }

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

// Format a date (or ISO timestamp) as "Jun 01". Returns '' for blank.
function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d.length <= 10 ? `${d}T00:00:00` : d);
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
}

// ---------- bootstrap ----------
async function loadCompanies() {
  companies = await api('/companies');
  const sel = $('company');
  sel.innerHTML = '';
  if (!companies.length) { sel.innerHTML = '<option value="">(no companies)</option>'; return; }
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
async function loadToday() {
  if (!companyId) return;
  const rows = await api(`/queue?company_id=${companyId}`);
  const body = $('today-body'); body.innerHTML = '';
  $('today-empty').classList.toggle('hidden', rows.length > 0);
  const cooling = rows.filter((r) => r.going_cold).length;
  $('today-note').textContent = `${rows.length} due${cooling ? ` · ${cooling} going cold` : ''}`;
  for (const r of rows) {
    const tr = document.createElement('tr');
    const next = r.next_step_purpose ? `[${esc(r.next_step_channel || '')}] ${esc(r.next_step_purpose)}` : '<span class="muted">— no steps —</span>';
    tr.innerHTML = `
      <td><img class="thumb" src="${photoUrl(r)}"></td>
      <td class="name-cell">${esc(r.name)} ${r.going_cold ? '<span class="badge cooling">cooling</span>' : ''}</td>
      <td>${typeBadge(r.type)}</td>
      <td>${esc(r.campaign_name) || '<span class="muted">unassigned</span>'}</td>
      <td>${next}</td>
      <td>${r.priority_score ?? ''}</td>
      <td>${heatBadge(r.hot_cold)}</td>
      <td class="muted">${fmtDate(r.next_action_date) || 'now'}</td>`;
    tr.onclick = (e) => { if (!e.target.closest('.nick, .nick-input')) openPerson(r.id); };
    tr.querySelector('.name-cell').appendChild(makeNick(r.id, r.label || ''));
    body.appendChild(tr);
  }
}

// ---------- Roster ----------
// Click a column header to sort by it; click the active one again to flip direction.
// Default: priority high → low (matches the server's default order).
let rosterSort = { by: 'priority', dir: 'desc' };
const SORT_VALUE = {
  priority: (r) => r.priority_score,
  next_action: (r) => (r.next_action_date ? r.next_action_date.slice(0, 10) : null),
  step: (r) => r.current_step,
};
// The direction a column starts in the first time you click it.
const SORT_DEFAULT_DIR = { priority: 'desc', next_action: 'asc', step: 'asc' };

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
  const qs = `company_id=${companyId}` + (status ? `&status=${status}` : '');
  const rows = await api(`/people?${qs}`);
  sortRoster(rows);
  updateSortArrows();
  const body = $('roster-body'); body.innerHTML = '';
  $('roster-empty').classList.toggle('hidden', rows.length > 0);
  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><img class="thumb" src="${photoUrl(r)}"></td>
      <td class="name-cell">${esc(r.name)} </td>
      <td>${typeBadge(r.type)}</td>
      <td>${esc(r.title)}</td>
      <td>${esc(r.campaign_name) || '<span class="muted">—</span>'}</td>
      <td>${r.current_step ? 'step ' + r.current_step : ''}</td>
      <td>${r.priority_score ?? ''}</td>
      <td>${heatBadge(r.hot_cold)}</td>
      <td class="muted">${fmtDate(r.next_action_date)}</td>`;
    tr.onclick = (e) => { if (!e.target.closest('.nick, .nick-input')) openPerson(r.id); };
    tr.querySelector('.name-cell').appendChild(makeNick(r.id, r.label || ''));
    body.appendChild(tr);
  }
}

// ---------- Person detail ----------
async function openPerson(id) {
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
  $('p-priority_score').value = person.priority_score ?? '';
  $('p-next_action_date').value = person.next_action_date ? person.next_action_date.slice(0, 10) : '';
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
  for (const s of run.steps) stepsHost.appendChild(stepCard(s));
}

function stepCard(s) {
  const el = document.createElement('div');
  el.className = 'step' + (s.sent ? ' sent' : '');
  el.innerHTML = `
    <div class="step-head">
      <span class="num">${s.step_order}</span>
      <input data-f="channel" value="${esc(s.channel)}" placeholder="channel" style="width:120px">
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

  el.querySelector('.save-step').onclick = async () => {
    const payload = collect();
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
  return el;
}

async function saveTracker() {
  const body = {
    label: $('p-label').value.trim() || null,
    hot_cold: $('p-hot_cold').value || null,
    priority_score: $('p-priority_score').value === '' ? null : Number($('p-priority_score').value),
    next_action_date: $('p-next_action_date').value || null,
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
  for (const s of editingCampaign.steps) host.appendChild(campaignStepRow(s));
}
function campaignStepRow(s) {
  const el = document.createElement('div');
  el.className = 'cstep';
  el.dataset.stepId = s.id;
  el.innerHTML = `
    <input data-f="step_order" value="${esc(s.step_order)}" title="order">
    <input data-f="channel" value="${esc(s.channel)}" placeholder="channel">
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

// ---------- wire up ----------
$('tab-today').onclick = () => { show('today'); loadToday(); };
$('tab-roster').onclick = () => { show('roster'); loadRoster(); };
$('tab-campaigns').onclick = () => { show('campaigns'); loadCampaigns(); };
$('company').onchange = (e) => { companyId = Number(e.target.value); loadToday(); };
$('refresh-today').onclick = loadToday;
$('refresh-roster').onclick = loadRoster;
$('roster-status').onchange = loadRoster;
document.querySelectorAll('#view-roster th.sortable').forEach((th) => {
  th.onclick = () => setRosterSort(th.dataset.sort);
});
$('back-from-person').onclick = () => { show('today'); loadToday(); };
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

// ---------- boot ----------
(async () => {
  try {
    await loadCompanies();
    await loadCampaignList();
    await loadToday();
  } catch (e) { toast(e.message); }
})();
