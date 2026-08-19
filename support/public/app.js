// support SPA — vanilla JS. A 3-column Kanban board of the personal network: one card per PERSON,
// dragged by hand between Active / Waiting / Inactive and ordered within a column. Nothing moves a
// card automatically. The card face is name + company + channel/recc badges + the notes (clamped);
// clicking it opens the edit view. Rows captured via Sniper's "→ Support" button arrive linked
// (photo/title joined by linkedin_slug server-side) and land at the top of Active.
const $ = (id) => document.getElementById(id);

// --- Theme + cross-app links (shared chrome) ---
(function initChrome() {
  const host = location.hostname;
  const set = (id, port) => { const a = $(id); if (a) a.href = `${location.protocol}//${host}:${port}/`; };
  set('link-sniper', 7700); set('link-medic', 7701); set('link-engineer', 7702);
  set('link-specops', 7703); set('link-uav', 7704); set('link-commander', 7705);
  set('link-antitank', 7706);
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
const send = (method) => (path, obj) => api(path, { method, headers: { 'Content-Type': 'application/json' }, body: obj ? JSON.stringify(obj) : undefined });
const jsonPost = send('POST'), jsonPatch = send('PATCH'), jsonPut = send('PUT');
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), 2600);
}

const COLUMNS = [
  { key: 'active', label: 'Active' },
  { key: 'waiting', label: 'Waiting' },
  { key: 'inactive', label: 'Inactive' },
];
// A channel is a badge on the card face and, when a touch is completed, the verb on its stamp.
// LinkedIn has no emoji, so it wears an "in" lettermark (styled in CSS).
const CHANNELS = [
  { key: 'call', icon: '📞', label: 'Call', verb: 'Called' },
  { key: 'text', icon: '💬', label: 'Text', verb: 'Texted' },
  { key: 'email', icon: '✉️', label: 'Email', verb: 'Emailed' },
  { key: 'linkedin', icon: 'in', label: 'LinkedIn', verb: 'Messaged' },
];
const CHANNEL = Object.fromEntries(CHANNELS.map((c) => [c.key, c]));

// --- state ---
let people = [];
let drag = null;                       // id of the card being dragged
const filters = { q: '', recc: false, channel: '', hideDone: false };

// Which cards have their notes un-clamped, persisted so the board looks the same after a reload.
let expanded = new Set();
try { expanded = new Set(JSON.parse(localStorage.getItem('support.expanded') || '[]')); } catch { /* ignore */ }
const saveExpanded = () => localStorage.setItem('support.expanded', JSON.stringify([...expanded]));

const findPerson = (id) => people.find((p) => p.id === id);

// --- filtering (client-side, so columns never vanish mid-drag) ---
function matches(p) {
  if (filters.recc && !p.recc_flag) return false;
  if (filters.channel && !(p.channels || []).includes(filters.channel)) return false;
  if (filters.hideDone && p.completed) return false;
  if (filters.q) {
    const hay = [p.display_name, p.display_company, p.note].filter(Boolean).join(' ').toLowerCase();
    if (!hay.includes(filters.q)) return false;
  }
  return true;
}

// --- rendering ---
function initials(name) {
  return (name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
}

function avatarHTML(p) {
  const fallback = `<div class="avatar initials">${esc(initials(p.display_name))}</div>`;
  if (p.linked && p.photo_path) {
    return `<img class="avatar" src="/media/${esc(p.photo_path)}" alt=""
              onerror="this.outerHTML='${fallback.replace(/"/g, '&quot;')}'">`;
  }
  return fallback;
}

const channelBadge = (key) => {
  const c = CHANNEL[key];
  return c ? `<span class="badge chan chan-${c.key}" title="${c.label}">${c.icon}</span>` : '';
};

// The completed strip: "✅ Texted" across the top of the card. Without a recorded channel (no
// badges on the card when it was ticked) it falls back to a plain "Completed".
function stampHTML(p) {
  if (!p.completed) return '';
  const verb = CHANNEL[p.completed_via]?.verb || 'Completed';
  return `<div class="c-stamp">✅ ${esc(verb)}</div>`;
}

function card(p) {
  const isOpen = expanded.has(p.id);
  const badges = (p.channels || []).map(channelBadge).join('')
    + (p.recc_flag ? '<span class="badge recc" title="LinkedIn recommendation owed">🏅</span>' : '');
  const note = p.note ? `<div class="c-note${isOpen ? ' open' : ''}">${esc(p.note)}</div>` : '';
  // The expand chevron only earns its place when there's a note that could actually be clipped.
  const chev = p.note
    ? `<button class="c-expand" data-expand="${p.id}" draggable="false" title="${isOpen ? 'Clamp notes' : 'Show all notes'}">${isOpen ? '▴' : '▾'}</button>`
    : '';
  return `<div class="card${p.completed ? ' completed' : ''}" draggable="true" data-id="${p.id}">
    ${stampHTML(p)}
    <div class="c-head">
      ${avatarHTML(p)}
      <span class="c-name">${esc(p.display_name || '(unnamed)')}</span>
      <span class="c-badges">${badges}</span>
      ${chev}
    </div>
    ${p.display_company ? `<div class="c-company">${esc(p.display_company)}</div>` : ''}
    ${note}
  </div>`;
}

function renderBoard() {
  const visible = people.filter(matches);
  const filtering = filters.q || filters.recc || filters.channel || filters.hideDone;
  $('filter-note').textContent = filtering ? `${visible.length} of ${people.length} shown` : '';

  $('board').innerHTML = COLUMNS.map((col) => {
    const inCol = visible.filter((p) => p.status === col.key);
    const body = inCol.length
      ? inCol.map(card).join('')
      : `<div class="col-empty">${filtering ? 'Nothing matches here' : 'Drop a card here'}</div>`;
    return `<div class="col" data-status="${col.key}">
      <div class="col-head">
        <span class="name">${col.label}</span>
        <span class="count">${inCol.length}</span>
      </div>
      <div class="col-list">${body}</div>
    </div>`;
  }).join('');

  wireBoard();
}

// --- drag & drop: cards move between columns and reorder within one ---
let dropMarker = null;
function ensureMarker() {
  if (!dropMarker) { dropMarker = document.createElement('div'); dropMarker.className = 'drop-marker'; }
  return dropMarker;
}
function clearMarker() { if (dropMarker?.parentNode) dropMarker.remove(); }
// Which card the cursor currently sits above (its midpoint decides above/below), or null for "end".
function markerRef(colList, clientY) {
  for (const el of colList.querySelectorAll('.card:not(.dragging)')) {
    const r = el.getBoundingClientRect();
    if (clientY < r.top + r.height / 2) return el;
  }
  return null;
}
const sameOrder = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

function wireBoard() {
  const board = $('board');
  board.querySelectorAll('.card').forEach((el) => {
    el.addEventListener('dragstart', (e) => {
      drag = Number(el.dataset.id);
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', () => { el.classList.remove('dragging'); drag = null; clearMarker(); });
    el.addEventListener('click', () => { const p = findPerson(Number(el.dataset.id)); if (p) openEdit(p); });
  });

  // Notes expand/clamp — a card-local toggle that must not open the edit view or start a drag.
  board.querySelectorAll('[data-expand]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = Number(el.dataset.expand);
      if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
      saveExpanded();
      renderBoard();
    });
  });

  board.querySelectorAll('.col').forEach((col) => {
    const colList = col.querySelector('.col-list');
    col.addEventListener('dragover', (e) => {
      e.preventDefault();
      col.classList.add('drag-over');
      colList.insertBefore(ensureMarker(), markerRef(colList, e.clientY));
    });
    col.addEventListener('dragleave', (e) => {
      // dragleave also fires when moving onto a child — only react on a real exit.
      if (!col.contains(e.relatedTarget)) col.classList.remove('drag-over');
    });
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const dropped = drag;
      const ref = markerRef(colList, e.clientY);
      clearMarker();
      if (dropped == null) return;
      const status = col.dataset.status;

      // The column's new top-to-bottom order: the cards already here (minus the dragged one),
      // with the dragged id spliced in where the insertion line sat.
      const ids = [...colList.querySelectorAll('.card:not(.dragging)')].map((el) => Number(el.dataset.id));
      const at = ref ? ids.indexOf(Number(ref.dataset.id)) : -1;
      ids.splice(at < 0 ? ids.length : at, 0, dropped);

      // No-op guard: dropped back in its own column at the same spot.
      const before = [...colList.querySelectorAll('.card')].map((el) => Number(el.dataset.id));
      if (findPerson(dropped)?.status === status && sameOrder(before, ids)) return;

      // A filtered board only shows some cards; send the full column order so the hidden ones
      // keep their relative places instead of being renumbered to the bottom.
      const shown = new Set(ids);
      const full = people
        .filter((p) => p.status === status && !shown.has(p.id) && p.id !== dropped)
        .map((p) => p.id);
      const merged = ids.concat(full.filter((id) => !shown.has(id)));

      try { await jsonPut('/api/people/reorder', { status, ids: merged }); await load(); }
      catch (err) { toast(`✗ ${err.message}`); }
    });
  });
}

async function load() {
  try { people = await api('/api/people'); }
  catch (e) { $('board').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  if (!people.length) {
    $('board').innerHTML = `<div class="empty">Nobody here yet.<br>Add someone manually, or hit "→ Support" in the Sniper extension on a LinkedIn profile.</div>`;
    return;
  }
  renderBoard();
}

// --- edit view ---
function openModal() { $('modal').classList.remove('hidden'); }
function closeModal() { $('modal').classList.add('hidden'); $('modal-body').innerHTML = ''; }
$('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('modal').classList.contains('hidden')) closeModal();
});

function openEdit(p) {
  const chanBoxes = CHANNELS.map((c) => `
    <label class="chk chan-pick"><input type="checkbox" data-chan="${c.key}"${(p.channels || []).includes(c.key) ? ' checked' : ''}>
      <span class="badge chan chan-${c.key}">${c.icon}</span> ${c.label}</label>`).join('');
  const viaOpts = ['<option value="">—</option>']
    .concat(CHANNELS.map((c) => `<option value="${c.key}"${p.completed_via === c.key ? ' selected' : ''}>${c.verb}</option>`)).join('');

  $('modal-body').innerHTML = `
    <h2>${esc(p.display_name || '(unnamed)')}</h2>
    <div class="sub">${p.linked && p.linkedin_url
      ? `<a class="link" href="${esc(p.linkedin_url)}" target="_blank" rel="noopener">LinkedIn profile ↗</a>${p.title ? ' · ' + esc(p.title) : ''}`
      : (p.linkedin_slug ? 'linked to a LinkedIn profile, not captured yet' : 'manual entry')}</div>

    <div class="row2">
      <div class="field"><label>Name</label><input data-f="name" type="text" value="${esc(p.name || p.display_name || '')}"></div>
      <div class="field"><label>Company</label><input data-f="company" type="text" value="${esc(p.company || p.display_company || '')}" placeholder="Where they work"></div>
    </div>

    <div class="field"><label>Notes</label>
      <textarea data-f="note" rows="7" placeholder="Context, contact info, what you owe them…">${esc(p.note || '')}</textarea>
    </div>

    <div class="field"><label>Badges</label>
      <div class="chan-picks">${chanBoxes}</div>
      <label class="chk"><input type="checkbox" id="e-recc"${p.recc_flag ? ' checked' : ''}>
        <span class="badge recc">🏅</span> LinkedIn recc owed</label>
    </div>

    <div class="field"><label>Completed</label>
      <div class="done-row">
        <label class="chk"><input type="checkbox" id="e-completed"${p.completed ? ' checked' : ''}> ✅ Mark completed</label>
        <label class="chk via${p.completed ? '' : ' hidden'}" id="e-via-wrap">via <select id="e-via">${viaOpts}</select></label>
      </div>
      <div class="hint muted${p.completed && p.completed_at ? '' : ' hidden'}" id="e-done-at">${p.completed_at ? 'Ticked ' + esc(String(p.completed_at).slice(0, 10)) : ''}</div>
    </div>

    <div class="modal-actions">
      <button class="primary" id="m-save">Save</button>
      <button id="m-close">Close</button>
      <span class="spacer"></span>
      <button class="ghost danger sm" id="m-delete">Delete</button>
    </div>`;

  const body = $('modal-body');
  const pickedChannels = () => [...body.querySelectorAll('[data-chan]')].filter((b) => b.checked).map((b) => b.dataset.chan);
  const completedBox = $('e-completed');
  const viaSel = $('e-via');

  // Ticking Completed reveals the "via" picker. One channel on the card = the verb is obvious, so
  // prefill it; several = leave it for a deliberate pick, which is what makes the stamp accurate.
  const syncVia = () => {
    $('e-via-wrap').classList.toggle('hidden', !completedBox.checked);
    if (completedBox.checked && !viaSel.value) {
      const chans = pickedChannels();
      if (chans.length === 1) viaSel.value = chans[0];
    }
  };
  completedBox.onchange = syncVia;
  body.querySelectorAll('[data-chan]').forEach((b) => { b.onchange = syncVia; });

  $('m-close').onclick = closeModal;
  $('m-save').onclick = async () => {
    const payload = {
      name: body.querySelector('[data-f="name"]').value.trim() || null,
      company: body.querySelector('[data-f="company"]').value.trim() || null,
      note: body.querySelector('[data-f="note"]').value.trim() || null,
      channels: pickedChannels(),
      recc_flag: $('e-recc').checked,
      completed: completedBox.checked,
      completed_via: completedBox.checked ? (viaSel.value || null) : null,
    };
    try { await jsonPatch(`/api/people/${p.id}`, payload); closeModal(); await load(); }
    catch (e) { toast(`✗ ${e.message}`); }
  };
  $('m-delete').onclick = async () => {
    if (!confirm('Remove this person from Support? (Sniper data, if any, is untouched.)')) return;
    try { await api(`/api/people/${p.id}`, { method: 'DELETE' }); closeModal(); await load(); }
    catch (e) { toast(`✗ ${e.message}`); }
  };
  openModal();
}

// --- toolbar ---
$('f-search').oninput = (e) => { filters.q = e.target.value.trim().toLowerCase(); renderBoard(); };
$('f-recc').onclick = () => {
  filters.recc = !filters.recc;
  $('f-recc').classList.toggle('active-tog', filters.recc);
  renderBoard();
};
$('f-channel').onchange = (e) => { filters.channel = e.target.value; renderBoard(); };
$('f-hide-done').onclick = () => {
  filters.hideDone = !filters.hideDone;
  $('f-hide-done').classList.toggle('active-tog', filters.hideDone);
  renderBoard();
};

$('add-toggle').onclick = () => { $('add-form').classList.toggle('hidden'); $('add-name').focus(); };
$('add-cancel').onclick = () => $('add-form').classList.add('hidden');
$('add-save').onclick = async () => {
  const body = {
    name: $('add-name').value.trim() || null,
    company: $('add-company').value.trim() || null,
    linkedin_url: $('add-url').value.trim() || null,
    note: $('add-note').value.trim() || null,
  };
  try {
    await jsonPost('/api/people', body);
  } catch (e) { toast(`✗ ${e.message}`); return; }
  $('add-name').value = $('add-company').value = $('add-url').value = $('add-note').value = '';
  $('add-form').classList.add('hidden');
  toast('Added to Active');
  load();
};

load();
