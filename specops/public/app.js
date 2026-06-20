// specops SPA — vanilla JS. A Kanban board of opportunities; cards drag between stage columns.
const $ = (id) => document.getElementById(id);

// --- Theme + cross-app links (shared chrome) ---
(function initChrome() {
  const host = location.hostname;
  const medic = $('link-medic'); if (medic) medic.href = `${location.protocol}//${host}:7701/`;
  const eng = $('link-engineer'); if (eng) eng.href = `${location.protocol}//${host}:7702/`;
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
  { key: 'outreach', label: 'Outreach' },
  { key: 'hm_reply', label: 'HM Reply' },
  { key: 'screen', label: 'Screen' },
  { key: 'interview', label: 'Interview' },
  { key: 'onsite', label: 'Onsite' },
  { key: 'offer', label: 'Offer' },
  { key: 'closed', label: 'Closed' },
];
const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.key, s.label]));
const OUTCOMES = ['accepted', 'rejected', 'withdrawn'];

function photoUrl(p) {
  return p && p.photo_path ? `/media/${p.photo_path}`
    : 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="%231f2430"/></svg>');
}
const typeBadge = (t) => (t ? `<span class="badge ${esc(t)}">${esc(t.replace('_', ' '))}</span>` : '');
// Deep link to a contact's detail in Medic (shared people table -> same id, new tab).
const medicLink = (pid) => `${location.protocol}//${location.hostname}:7701/?person=${pid}`;

// --- state ---
let companies = [];
let companyId = 'all';
let opportunities = [];
const peopleCache = {}; // company_id -> people[]
let dragId = null;

const findOpp = (id) => opportunities.find((o) => o.id === id);

// ---------- bootstrap ----------
async function loadCompanies() {
  companies = await api('/companies');
  const sel = $('company');
  sel.innerHTML = '<option value="all">All companies</option>'
    + companies.map((c) => `<option value="${c.id}">${esc(c.name)} (${c.active_contacts})</option>`).join('');
  sel.value = 'all';
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
  opportunities = await api(path);
  renderBoard();
}

function renderBoard() {
  const board = $('board');
  // Show the board OR the empty-state hint, never both stacked.
  const empty = opportunities.length === 0;
  $('board-empty').classList.toggle('hidden', !empty);
  board.classList.toggle('hidden', empty);
  const open = opportunities.filter((o) => o.stage !== 'closed').length;
  $('board-note').textContent = opportunities.length ? `${opportunities.length} total · ${open} open` : '';

  board.innerHTML = STAGES.map((s) => {
    const inStage = opportunities.filter((o) => o.stage === s.key);
    const cards = inStage.map(card).join('');
    return `<div class="col ${s.key}" data-stage="${s.key}">
      <div class="col-head"><span class="name">${s.label}</span><span class="count">${inStage.length}</span></div>
      <div class="col-list">${cards}</div>
    </div>`;
  }).join('');

  wireBoard();
}

function card(o) {
  const primary = (o.contacts || []).find((c) => c.is_primary) || (o.contacts || [])[0];
  const meta = [o.comp_range, o.location].filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join('');
  const extra = (o.contacts || []).length > 1 ? `<span class="muted" style="font-size:11px">+${o.contacts.length - 1}</span>` : '';
  const contactBit = primary
    ? `<div class="oc-contacts"><img class="thumb sm" src="${photoUrl(primary)}" title="${esc(primary.name)}"> <span style="font-size:12px">${esc(primary.name)}</span> ${extra}</div>`
    : '<div class="oc-contacts muted" style="font-size:12px">no contact yet</div>';
  const outcome = o.stage === 'closed' && o.outcome ? `<span class="badge outcome">${esc(o.outcome)}</span>` : '';
  return `<div class="opp-card" draggable="true" data-id="${o.id}">
    <div class="oc-company">${esc(o.company_name)} ${outcome}</div>
    <div class="oc-role">${o.role_title ? esc(o.role_title) : '<span class="muted">untitled role</span>'}</div>
    ${meta ? `<div class="oc-meta">${meta}</div>` : ''}
    ${contactBit}
  </div>`;
}

function wireBoard() {
  const board = $('board');
  board.querySelectorAll('.opp-card').forEach((el) => {
    el.addEventListener('dragstart', (e) => { dragId = Number(el.dataset.id); el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
    el.addEventListener('dragend', () => { el.classList.remove('dragging'); dragId = null; });
    el.addEventListener('click', () => { const o = findOpp(Number(el.dataset.id)); if (o) openDetail(o); });
  });
  board.querySelectorAll('.col').forEach((col) => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drag-over'); });
    col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const id = dragId;
      const stage = col.dataset.stage;
      const o = findOpp(id);
      if (!o || o.stage === stage) return;
      try { await jsonPut(`/opportunities/${id}`, { stage }); await loadBoard(); }
      catch (err) { toast(err.message); }
    });
  });
}

// ---------- modal ----------
function openModal() { $('modal').classList.remove('hidden'); }
function closeModal() { $('modal').classList.add('hidden'); $('modal-body').innerHTML = ''; $('modal-body').classList.remove('two-col'); }
$('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('modal').classList.contains('hidden')) closeModal(); });

const stageOptions = (sel) => STAGES.map((s) => `<option value="${s.key}"${s.key === sel ? ' selected' : ''}>${s.label}</option>`).join('');

// ---- create ----
function openCreate() {
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
    <div class="field"><label>Stage</label><select data-f="stage">${stageOptions('outreach')}</select></div>
    <div class="modal-actions">
      <button class="primary" id="m-create">Create</button>
      <span class="spacer"></span>
      <button id="m-cancel">Cancel</button>
    </div>`;
  // Pre-select the company the board is currently filtered to, if any.
  if (companyId !== 'all') { const cs = $('modal-body').querySelector('[data-f="company_id"]'); if (cs) cs.value = String(companyId); }
  $('m-cancel').onclick = closeModal;
  $('m-create').onclick = async () => {
    const payload = collect($('modal-body'));
    payload.company_id = Number(payload.company_id);
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
    <h2>${esc(o.company_name)}</h2>
    <div class="sub">${o.role_title ? esc(o.role_title) : 'untitled role'} · ${STAGE_LABEL[o.stage]}</div>

    <div class="mcol">
      <div class="field"><label>Role title</label><input data-f="role_title" type="text" value="${esc(o.role_title)}" placeholder="placeholder is fine"></div>
      <div class="field"><label>Job posting URL</label><input data-f="job_posting_url" type="url" value="${esc(o.job_posting_url)}" placeholder="(optional — many roles aren't listed)"></div>
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
      <div class="field"><label>Opportunity notes</label><textarea data-f="notes" placeholder="Prep, threads, interview context…">${esc(o.notes)}</textarea></div>
    </div>

    <div class="mcol">
      ${primary ? `<div class="field">
        <label>Primary HM notes — ${esc(primary.name)} <span class="muted" style="text-transform:none;letter-spacing:0">· from Medic, read-only</span></label>
        <div class="hm-notes">
          ${primary.my_notes ? `<div class="note-block">${esc(primary.my_notes)}</div>` : ''}
          ${primary.ai_summary ? `<div class="note-block ai"><span class="muted">AI summary</span>\n${esc(primary.ai_summary)}</div>` : ''}
          ${(!primary.my_notes && !primary.ai_summary) ? '<span class="muted" style="font-size:13px">No notes on this contact yet — add them in Medic.</span>' : ''}
          <a class="link" href="${medicLink(primary.person_id)}" target="_blank" rel="noopener"><img class="ic14" src="icons/meddic-20.png" alt=""> Edit in Medic ↗</a>
        </div>
      </div>` : ''}

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

    <div class="modal-actions">
      <button class="primary" id="m-save">Save</button>
      <button id="m-close">Close</button>
      <span class="spacer"></span>
      <label class="footer-outcome">Outcome <select data-f="outcome">${outcomeOpts}</select></label>
      <button class="bad sm" id="m-delete">Delete</button>
    </div>`;

  // contact row actions
  $('contacts-list').querySelectorAll('[data-remove]').forEach((el) => {
    el.onclick = async () => { try { const upd = await api(`/opportunities/${o.id}/contacts/${el.dataset.remove}`, { method: 'DELETE' }); await renderDetail(upd); refreshUnder(); } catch (e) { toast(e.message); } };
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
    const role = { hiring_manager: 'hiring manager', recruiter: 'recruiter', peer: 'peer' }[person.type] || null;
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

  $('m-close').onclick = closeModal;
  $('m-save').onclick = async () => {
    try { await jsonPut(`/opportunities/${o.id}`, collect($('modal-body'))); closeModal(); await loadBoard(); }
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
      <div class="cr-title">${typeBadge(c.type)} ${c.role ? esc(c.role) : ''}${c.title ? ' · ' + esc(c.title) : ''}</div>
    </div>
    <span class="spacer"></span>
    <a class="link" href="${medicLink(c.person_id)}" target="_blank" rel="noopener"><img class="ic14" src="icons/meddic-20.png" alt=""> Medic ↗</a>
    ${c.is_primary ? '' : `<a class="link" data-primary="${c.person_id}">make primary</a>`}
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
$('new-opp').onclick = openCreate;
$('company').onchange = (e) => { companyId = e.target.value === 'all' ? 'all' : Number(e.target.value); loadBoard().catch((err) => toast(err.message)); };

(async function init() {
  try {
    await loadCompanies();
    await loadBoard();
  } catch (e) { toast(e.message); }
})();
