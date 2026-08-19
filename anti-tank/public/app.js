// anti-tank SPA — vanilla JS. Interview prep per SpecOps opportunity: a Briefing dossier
// (cross-app: SpecOps + Sniper + Commander + UAV, plus own angle/checklist), a Drill mode over the
// question bank (reveal → self-grade, optional local-qwen3 pushback), and a global STAR-story
// library. Hash-routed: #/ = home, #/opp/<id>/<tab>, #/stories.
const $ = (id) => document.getElementById(id);

// --- Theme + cross-app links (shared chrome) ---
(function initChrome() {
  const host = location.hostname;
  const set = (id, port) => { const a = $(id); if (a) a.href = `${location.protocol}//${host}:${port}/`; };
  set('link-sniper', 7700); set('link-medic', 7701); set('link-engineer', 7702);
  set('link-specops', 7703); set('link-uav', 7704); set('link-commander', 7705);
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
  if (!r.ok) throw new Error(body?.problems?.join('; ') || body?.error || `HTTP ${r.status}`);
  return body;
});
const esc = (s) => (s == null ? '' : String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));
const send = (method) => (path, obj) => api(path, { method, headers: { 'Content-Type': 'application/json' }, body: obj ? JSON.stringify(obj) : undefined });
const jsonPost = send('POST'), jsonPut = send('PUT'), jsonPatch = send('PATCH');
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), 2600);
}

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');
const app = () => $('app');
const companyLogo = (id, cls = 'co-logo') =>
  (id ? `<img class="${cls}" src="/media/company-icons/${id}.png" alt="" onerror="this.style.display='none'">` : '');
const photoUrl = (p) => (p ? `/media/${p}` : '');
const commanderUrl = () => `${location.protocol}//${location.hostname}:7705/`;
const specopsUrl = () => `${location.protocol}//${location.hostname}:7703/`;

const STAGE_LABEL = {
  lead: 'Lead', outreach: 'Outreach', outreach_today: 'Outreach today',
  completed_outreach: 'Completed outreach', hm_reply: 'HM reply',
  screen_interview: 'Screen & Interview', closed: 'Closed',
};
const CATEGORIES = ['behavioral', 'technical', 'company', 'role', 'logistics', 'curveball', 'general'];
const PHASES = [['before', 'Before'], ['day_of', 'Day of'], ['after', 'After']];

// --- mini-markdown renderer (escape-FIRST, injection-safe; from commander) ---
function md(src) {
  let h = esc(src);
  h = h.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  h = h.replace(/^###\s+(.+)$/gm, '<h5>$1</h5>')
       .replace(/^##\s+(.+)$/gm, '<h4>$1</h4>')
       .replace(/^#\s+(.+)$/gm, '<h4>$1</h4>');
  h = h.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
       .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
  h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a class="link" href="$2" target="_blank" rel="noopener">$1</a>');
  h = h.replace(/(^|\n)((?:- [^\n]*(?:\n|$))+)/g, (m, pre, block) =>
    `${pre}<ul>${block.trim().split('\n').map((l) => `<li>${l.replace(/^- /, '')}</li>`).join('')}</ul>`);
  h = h.replace(/(<\/(?:h4|h5|ul)>)\n/g, '$1').replace(/\n/g, '<br>');
  return h;
}

// ======================= HOME =======================
let showAll = localStorage.getItem('at-show-all') === '1';

async function renderHome() {
  app().innerHTML = `<div class="empty">Loading opportunities…</div>`;
  let data;
  try { data = await api(`/api/opportunities${showAll ? '?all=1' : ''}`); }
  catch (e) { app().innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }

  const cardHTML = (o) => {
    const qMeter = o.question_count
      ? `<span class="meter"><span class="m-label">Drill</span> ${o.nailed_count}<span class="m-sub">nailed</span> / ${o.drilled_count}<span class="m-sub">drilled</span> / ${o.question_count}<span class="m-sub">bank</span></span>`
      : `<span class="meter dim"><span class="m-label">Drill</span> no questions yet</span>`;
    const cPct = o.checklist_total ? Math.round((o.checklist_done / o.checklist_total) * 100) : 0;
    const cMeter = o.checklist_total
      ? `<span class="meter"><span class="m-label">Checklist</span> ${o.checklist_done}/${o.checklist_total}<span class="bar"><span class="bar-fill" style="width:${cPct}%"></span></span></span>`
      : `<span class="meter dim"><span class="m-label">Checklist</span> —</span>`;
    return `<div class="ocard" data-opp="${o.id}">
      <div class="ocard-head">
        ${companyLogo(o.company_id)}
        <div class="ocard-titles">
          <span class="ocard-role">${esc(o.role_title || '(untitled role)')}</span>
          <span class="ocard-co">${esc(o.company)}</span>
        </div>
        <span class="badge stage-${esc(o.stage)}">${esc(STAGE_LABEL[o.stage] || o.stage)}</span>
      </div>
      <div class="ocard-meters">
        ${qMeter}
        ${cMeter}
        <span class="meter ${o.has_angle ? 'good' : 'dim'}"><span class="m-label">Angle</span> ${o.has_angle ? '✓ ready' : 'not written'}</span>
      </div>
    </div>`;
  };

  app().innerHTML = `
    <div class="toolbar">
      <button id="toggle-all" class="${showAll ? '' : 'primary'}">${showAll ? 'All stages' : '🎯 Prep stages'}</button>
      <span class="muted sm">${showAll ? 'every opportunity' : 'HM reply + Screen & Interview'}</span>
      <span class="spacer"></span>
      <button data-nav="#/stories">📚 Story library</button>
    </div>
    ${data.opportunities.length
      ? `<div class="ocards">${data.opportunities.map(cardHTML).join('')}</div>`
      : `<div class="empty">No opportunities ${showAll ? 'yet — create one in SpecOps' : 'in prep stages'}.<br><br>
          ${showAll ? `<a class="link" href="${specopsUrl()}" target="_blank" rel="noopener">Open SpecOps ↗</a>` : `<button data-toggle-all="1">Show all stages</button>`}
        </div>`}`;

  const tog = $('toggle-all');
  if (tog) tog.onclick = () => { showAll = !showAll; localStorage.setItem('at-show-all', showAll ? '1' : '0'); renderHome(); };
}

// ======================= OPPORTUNITY (Briefing / Drill) =======================
let BRIEFING = null;   // raw briefing payload for the opportunity being viewed
let OPP_ID = null;

async function renderOpportunity(id, tab) {
  OPP_ID = id;
  app().innerHTML = `<div class="empty">Assembling briefing…</div>`;
  try { BRIEFING = await api(`/api/opportunities/${id}/briefing`); }
  catch (e) { app().innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const o = BRIEFING.opportunity;

  const tabBtn = (key, label) =>
    `<button class="tab ${tab === key ? 'active' : ''}" data-nav="#/opp/${id}/${key}">${label}</button>`;

  app().innerHTML = `
    <div class="toolbar"><button class="sm" data-nav="#/">← All opportunities</button></div>
    <div class="co-head">
      ${companyLogo(o.company_id, 'co-logo lg')}
      <div class="ocard-titles">
        <span class="co-title">${esc(o.role_title || '(untitled role)')}</span>
        <span class="ocard-co">${esc(o.company)}</span>
      </div>
      <span class="badge stage-${esc(o.stage)}">${esc(STAGE_LABEL[o.stage] || o.stage)}</span>
      <div class="co-actions">
        ${o.job_posting_url ? `<a class="linkbtn" href="${esc(o.job_posting_url)}" target="_blank" rel="noopener">Posting ↗</a>` : ''}
        <a class="linkbtn" href="${specopsUrl()}" target="_blank" rel="noopener">SpecOps ↗</a>
      </div>
    </div>
    <div class="tabbar">
      ${tabBtn('briefing', '📋 Briefing')}
      ${tabBtn('drill', `🎤 Drill${BRIEFING.question_stats.total ? ` (${BRIEFING.question_stats.total})` : ''}`)}
      <button class="tab" data-nav="#/stories">📚 Stories</button>
    </div>
    <div id="tab-body"></div>`;

  if (tab === 'drill') await renderDrill(id);
  else renderBriefingTab();
}

// ---------- Briefing tab ----------
// Anti-Tank's own sections are edited here; the cross-app slices are read-only with link-outs.
const BRIEF_SECTION_TITLES = { angle: 'My Angle', questions_for_them: 'Questions for them', logistics: 'Logistics', notes: 'Notes' };
const briefTitle = (b) => b.title || BRIEF_SECTION_TITLES[b.section] || b.section.replace(/_/g, ' ');

function renderBriefingTab() {
  const b = BRIEFING;
  const o = b.opportunity;

  // My Angle first, then the other owned sections; 'angle' always renders (even when empty).
  const briefsBySection = new Map(b.briefs.map((r) => [r.section, r]));
  const order = ['angle', ...b.briefs.map((r) => r.section).filter((s) => s !== 'angle')];
  const briefSecs = order.map((sec) => {
    const row = briefsBySection.get(sec);
    return `<div class="bsec own" data-brief="${esc(sec)}">
      <div class="bsec-head"><span class="bsec-name">🚀 ${esc(row ? briefTitle(row) : BRIEF_SECTION_TITLES[sec] || sec)}</span>
        <span class="spacer"></span><button class="sm ghost" data-edit-brief="${esc(sec)}">Edit</button></div>
      ${row?.body_md?.trim() ? `<div class="bsec-body md">${md(row.body_md)}</div>`
        : `<div class="bsec-body muted italic">Not written yet — this is your positioning for THIS role. Edit, or import a prep pack.</div>`}
    </div>`;
  }).join('');

  const intel = b.company_intel.length
    ? b.company_intel.map((r) => `<div class="bsec">
        <div class="bsec-head"><span class="bsec-name">${esc(r.title || r.section.replace(/_/g, ' '))}</span>
          ${r.source_url ? `<a class="link sm" href="${esc(r.source_url)}" target="_blank" rel="noopener">source ↗</a>` : ''}</div>
        <div class="bsec-body md">${md(r.body)}</div>
      </div>`).join('')
    : `<div class="bsec"><div class="bsec-body muted">No Commander intel for ${esc(o.company)} yet —
        <a class="link" href="${commanderUrl()}" target="_blank" rel="noopener">add mission / values / interview guide in Commander ↗</a></div></div>`;

  const jp = b.job_posting;
  const groups = (jp?.groups || []).map((g) => `<span class="chip">${esc(g.name)}</span>`).join(' ');
  const role = `<div class="bsec">
    <div class="bsec-body">
      ${jp ? `<div class="kv"><span class="k">Posting</span><span>${jp.url ? `<a class="link" href="${esc(jp.url)}" target="_blank" rel="noopener">${esc(jp.title)} ↗</a>` : esc(jp.title)}${jp.closed_at ? ' <span class="badge stage-closed">closed</span>' : ''}</span></div>` : ''}
      ${jp?.location || o.location ? `<div class="kv"><span class="k">Location</span><span>${esc(jp?.location || o.location)}</span></div>` : ''}
      ${o.comp_range ? `<div class="kv"><span class="k">Comp</span><span>${esc(o.comp_range)}</span></div>` : ''}
      ${groups ? `<div class="kv"><span class="k">Teams</span><span>${groups}</span></div>` : ''}
      ${o.notes?.trim() ? `<div class="kv"><span class="k">SpecOps notes</span><span class="md">${md(o.notes)}</span></div>` : ''}
      ${!jp && !o.comp_range && !o.location && !o.notes?.trim() ? `<div class="muted">Nothing on file — link a UAV posting to this opportunity in SpecOps.</div>` : ''}
    </div>
  </div>`;

  const people = b.people.length ? b.people.map((p) => `
    <div class="pcard ${p.is_primary ? 'primary' : ''}">
      <div class="pcard-head">
        ${p.photo_path ? `<img class="pphoto" src="${esc(photoUrl(p.photo_path))}" onerror="this.style.display='none'">` : ''}
        <div>
          <div class="pname">${esc(p.name)} ${p.is_primary ? '<span class="badge primary-badge">primary</span>' : ''}</div>
          <div class="ptitle muted">${esc(p.title || p.current_title || '')}</div>
          <div class="prole sm">${esc(p.role || p.type || '')}${p.current_tenure ? ` · ${esc(p.current_tenure)}` : ''}</div>
        </div>
      </div>
      ${p.previous_title ? `<div class="sm muted">prev: ${esc(p.previous_title)}${p.previous_company ? ` @ ${esc(p.previous_company)}` : ''}</div>` : ''}
      ${p.ai_summary ? `<div class="psum md">${md(p.ai_summary)}</div>` : ''}
      ${p.my_notes ? `<div class="pnotes"><span class="k">My notes</span><div class="md">${md(p.my_notes)}</div></div>` : ''}
    </div>`).join('')
    : `<div class="muted" style="padding:6px 2px">No target people linked — add HMs to this opportunity in SpecOps.</div>`;

  // Checklist aside
  const cl = b.checklist;
  const done = cl.filter((i) => i.done).length;
  const pct = cl.length ? Math.round((done / cl.length) * 100) : 0;
  const phaseGroup = (key, label) => {
    const items = cl.filter((i) => i.phase === key);
    if (!items.length) return '';
    return `<div class="cl-phase"><div class="cl-phase-name">${label}</div>
      ${items.map((i) => `<label class="cl-item ${i.done ? 'done' : ''}">
        <input type="checkbox" data-check="${i.id}" ${i.done ? 'checked' : ''}>
        <span class="cl-label">${esc(i.label)}</span>
        <button class="ghost xx" data-del-check="${i.id}" title="Remove">✕</button>
      </label>`).join('')}</div>`;
  };
  const checklist = `
    <h3>Checklist ${cl.length ? `<span class="muted">${done}/${cl.length}</span>` : ''}</h3>
    ${cl.length ? `<div class="bar big"><span class="bar-fill" style="width:${pct}%"></span></div>` : ''}
    ${cl.length
      ? PHASES.map(([k, l]) => phaseGroup(k, l)).join('')
      : `<div class="muted sm" style="margin:8px 0">No checklist yet.</div>
         <button class="primary sm" data-instantiate="1">＋ Instantiate default checklist</button>`}
    <div class="cl-add">
      <input id="cl-new" type="text" placeholder="Add an item…">
      <select id="cl-new-phase">${PHASES.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
      <button class="sm" id="cl-add-btn">Add</button>
    </div>`;

  const pack = b.last_pack
    ? `Last prep pack: ${fmtDate(b.last_pack.imported_at)} (${b.last_pack.mode}, +${b.last_pack.questions_added} questions)`
    : `No prep pack imported yet.`;

  $('tab-body').innerHTML = `
    <div class="brief-layout">
      <div class="brief-main">
        ${briefSecs}
        <button class="sm ghost" data-add-brief="1">＋ Add section</button>
        <h3 class="bgroup">The Company <span class="muted">— Commander intel</span></h3>
        ${intel}
        <h3 class="bgroup">The Role <span class="muted">— UAV posting + SpecOps</span></h3>
        ${role}
        <h3 class="bgroup">The People <span class="muted">— target HMs via Sniper</span></h3>
        <div class="pcards">${people}</div>
        <div class="pack-foot">
          <span class="muted sm">📦 ${esc(pack)}</span>
          <details class="pack-hint"><summary class="sm link">how to generate one (Claude Code)</summary>
            <pre>curl :7706/api/pack-schema
curl :7706/api/opportunities/${o.id}/pack-context
# generate pack.json, then:
curl -X POST :7706/api/opportunities/${o.id}/pack \\
  -H 'Content-Type: application/json' -d @pack.json</pre>
          </details>
        </div>
      </div>
      <aside class="checklist">${checklist}</aside>
    </div>`;

  const addBtn = $('cl-add-btn');
  if (addBtn) addBtn.onclick = addChecklistItem;
  const inp = $('cl-new');
  if (inp) inp.onkeydown = (e) => { if (e.key === 'Enter') addChecklistItem(); };
}

async function addChecklistItem() {
  const label = $('cl-new').value.trim();
  if (!label) return;
  try {
    await jsonPost(`/api/opportunities/${OPP_ID}/checklist`, { label, phase: $('cl-new-phase').value });
    BRIEFING = await api(`/api/opportunities/${OPP_ID}/briefing`);
    renderBriefingTab();
  } catch (e) { toast(e.message); }
}

// Swap an owned brief section into its editor. Prefills from the RAW stored row, never the
// rendered markdown in the DOM.
function editBrief(sec) {
  const wrap = document.querySelector(`.bsec[data-brief="${CSS.escape(sec)}"]`);
  if (!wrap) return;
  const row = BRIEFING.briefs.find((r) => r.section === sec);
  const body = wrap.querySelector('.bsec-body');
  body.classList.remove('muted', 'italic', 'md');
  body.innerHTML = `
    <textarea class="brief-edit" placeholder="Markdown…">${esc(row?.body_md ?? '')}</textarea>
    <div style="margin-top:8px;display:flex;gap:8px">
      <button class="sm primary" data-save-brief="${esc(sec)}">Save</button>
      <button class="sm ghost" data-cancel-brief="1">Cancel</button>
    </div>`;
  body.querySelector('textarea').focus();
}

async function saveBrief(sec) {
  const wrap = document.querySelector(`.bsec[data-brief="${CSS.escape(sec)}"]`);
  const body_md = wrap.querySelector('textarea').value;
  try {
    await jsonPut(`/api/opportunities/${OPP_ID}/briefs/${encodeURIComponent(sec)}`, { body_md });
    toast('Saved');
    BRIEFING = await api(`/api/opportunities/${OPP_ID}/briefing`);
    renderBriefingTab();
  } catch (e) { toast(e.message); }
}

// ---------- Drill tab ----------
// Deck order is weakest-first: shaky > never-drilled > nailed (then bank order). A session is
// client-side state; each grade persists immediately via POST /grade.
let DRILL = null; // { questions, deck, idx, revealed, session: {nailed, shaky}, cat, shuffle, bank }

const drillScore = (q) => (q.last_grade === 'shaky' ? 0 : q.times_drilled === 0 ? 1 : 2);

async function renderDrill(id, keepState = false) {
  if (!keepState) {
    let data;
    try { data = await api(`/api/opportunities/${id}/questions`); }
    catch (e) { $('tab-body').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    DRILL = {
      questions: data.questions, deck: [], idx: 0, revealed: false,
      session: { nailed: 0, shaky: 0 }, cat: 'all', shuffle: false,
      bank: DRILL?.bank || false,
    };
    buildDeck();
  }
  DRILL.bank ? renderBank() : renderDeckCard();
}

function buildDeck() {
  let deck = DRILL.questions.filter((q) => DRILL.cat === 'all' || q.category === DRILL.cat);
  if (DRILL.shuffle) {
    deck = [...deck];
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  } else {
    deck = [...deck].sort((a, b) => drillScore(a) - drillScore(b) || a.sort_order - b.sort_order || a.id - b.id);
  }
  DRILL.deck = deck; DRILL.idx = 0; DRILL.revealed = false;
  DRILL.session = { nailed: 0, shaky: 0 };
}

function drillToolbar() {
  const cats = ['all', ...new Set(DRILL.questions.map((q) => q.category))];
  return `<div class="toolbar drill-bar">
    ${cats.map((c) => `<button class="cat-chip ${DRILL.cat === c ? 'active' : ''}" data-drill-cat="${esc(c)}">${esc(c)}</button>`).join('')}
    <button class="sm ${DRILL.shuffle ? 'active-tog' : ''}" data-drill-shuffle="1">🔀 Shuffle</button>
    <span class="spacer"></span>
    <button class="sm ghost" data-drill-bank="1">${DRILL.bank ? '🎤 Back to drill' : `🗂 Manage bank (${DRILL.questions.length})`}</button>
  </div>`;
}

function renderDeckCard() {
  const d = DRILL;
  if (!d.questions.length) {
    $('tab-body').innerHTML = `${drillToolbar()}
      <div class="empty">The question bank is empty.<br><br>
      Import a prep pack (see the Briefing tab footer) or add questions via 🗂 Manage bank.</div>`;
    return;
  }
  if (d.idx >= d.deck.length) {
    const { nailed, shaky } = d.session;
    $('tab-body').innerHTML = `${drillToolbar()}
      <div class="drill-card done-card">
        <div class="drill-q" style="font-size:20px">Deck complete 🎉</div>
        <div class="drill-summary">
          <span class="grade-pill nailed">😀 ${nailed} nailed</span>
          <span class="grade-pill shaky">😬 ${shaky} shaky</span>
        </div>
        <div class="drill-actions">
          <button class="primary" data-drill-restart="1">Drill again (weakest first)</button>
        </div>
      </div>`;
    return;
  }
  const q = d.deck[d.idx];
  const stats = q.times_drilled
    ? `<span class="muted sm">drilled ${q.times_drilled}× · ${q.nailed_count}😀 ${q.shaky_count}😬${q.last_grade ? ` · last: ${q.last_grade}` : ''}</span>`
    : `<span class="muted sm">never drilled</span>`;
  const storiesHTML = (q.stories || []).map((s) =>
    `<details class="story-inline" data-story-id="${s.id}"><summary>📚 ${esc(s.title)}</summary><div class="story-body muted sm">loading…</div></details>`).join('');

  $('tab-body').innerHTML = `${drillToolbar()}
    <div class="drill-card">
      <div class="drill-meta">
        <span class="chip cat-${esc(q.category)}">${esc(q.category)}</span>
        <span class="muted sm">Q ${d.idx + 1} / ${d.deck.length}</span>
        <span class="spacer"></span>
        ${stats}
      </div>
      <div class="drill-q">${esc(q.question)}</div>
      ${!d.revealed
        ? `<div class="drill-actions"><button class="primary big-btn" data-drill-reveal="1">Reveal my notes</button>
           <button class="ghost" data-drill-skip="1">Skip →</button></div>`
        : `
        <div class="drill-answer">
          ${q.my_answer_md?.trim() ? `<div class="md">${md(q.my_answer_md)}</div>` : `<div class="muted italic">No prepared answer yet — wing it, then grade honestly.</div>`}
          ${storiesHTML ? `<div class="drill-stories">${storiesHTML}</div>` : ''}
        </div>
        <div class="banter-zone">
          <textarea id="spoken-notes" placeholder="(optional) What did you actually say? Feeds the pushback…"></textarea>
          <button class="sm" data-drill-banter="${q.id}">🤨 Pushback (qwen)</button>
          <div id="banter-out"></div>
        </div>
        <div class="drill-actions">
          <button class="grade-btn nailed" data-drill-grade="nailed">😀 Nailed it</button>
          <button class="grade-btn shaky" data-drill-grade="shaky">😬 Shaky</button>
        </div>`}
    </div>`;
}

async function drillGrade(grade) {
  const q = DRILL.deck[DRILL.idx];
  try {
    const updated = await jsonPost(`/api/questions/${q.id}/grade`, { grade });
    Object.assign(q, updated);
    const master = DRILL.questions.find((x) => x.id === q.id);
    if (master) Object.assign(master, updated);
    DRILL.session[grade]++;
    DRILL.idx++; DRILL.revealed = false;
    renderDeckCard();
  } catch (e) { toast(e.message); }
}

async function drillBanter(qid, btn) {
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = '🤨 thinking…';
  const out = $('banter-out');
  try {
    const r = await jsonPost(`/api/questions/${qid}/banter`, { spoken_notes: $('spoken-notes')?.value || undefined });
    if (r.banter) out.innerHTML = `<div class="banter">🤨 <em>${esc(r.banter)}</em></div>`;
    else toast('Local model unavailable — no pushback this time');
  } catch (e) { toast(e.message); }
  btn.disabled = false; btn.textContent = label;
}

// Expand a linked story inline (lazy-fetch the library once per drill view).
let STORY_CACHE = null;
async function loadStoryInline(det) {
  const body = det.querySelector('.story-body');
  if (det.dataset.loaded) return;
  det.dataset.loaded = '1';
  try {
    if (!STORY_CACHE) STORY_CACHE = (await api('/api/stories')).stories;
    const s = STORY_CACHE.find((x) => x.id === Number(det.dataset.storyId));
    body.className = 'story-body';
    body.innerHTML = s ? starHTML(s) : '<span class="muted">story not found</span>';
  } catch (e) { body.textContent = e.message; }
}

function starHTML(s) {
  const rows = [['Situation', s.situation_md], ['Task', s.task_md], ['Action', s.action_md], ['Result', s.result_md]]
    .filter(([, v]) => v?.trim())
    .map(([k, v]) => `<div class="kv"><span class="k">${k}</span><span class="md">${md(v)}</span></div>`).join('');
  return `${rows}${s.body_md?.trim() ? `<div class="md" style="margin-top:6px">${md(s.body_md)}</div>` : ''}` || '<span class="muted">empty story</span>';
}

// ---------- Manage bank ----------
function renderBank() {
  const rows = DRILL.questions.map((q) => `
    <div class="bank-row" data-qid="${q.id}">
      <div class="bank-main">
        <span class="chip cat-${esc(q.category)}">${esc(q.category)}</span>
        <span class="bank-q">${esc(q.question)}</span>
        <span class="spacer"></span>
        <span class="muted sm">${q.times_drilled ? `${q.nailed_count}😀 ${q.shaky_count}😬` : 'new'}</span>
        <span class="badge src-${esc(q.source)}">${esc(q.source)}</span>
        <button class="sm ghost" data-edit-q="${q.id}">Edit</button>
      </div>
      <div class="bank-edit hidden" id="edit-q-${q.id}"></div>
    </div>`).join('');

  $('tab-body').innerHTML = `${drillToolbar()}
    <div class="bank">
      <div class="bank-add">
        <input id="new-q" type="text" placeholder="Add a question…">
        <select id="new-q-cat">${CATEGORIES.map((c) => `<option ${c === 'general' ? 'selected' : ''}>${c}</option>`).join('')}</select>
        <button class="primary sm" id="add-q-btn">Add</button>
      </div>
      ${rows || '<div class="empty">No questions yet.</div>'}
    </div>`;

  $('add-q-btn').onclick = async () => {
    const question = $('new-q').value.trim();
    if (!question) return;
    try {
      await jsonPost(`/api/opportunities/${OPP_ID}/questions`, { question, category: $('new-q-cat').value });
      await renderDrill(OPP_ID);
    } catch (e) { toast(e.message); }
  };
}

async function openQuestionEditor(qid) {
  const q = DRILL.questions.find((x) => x.id === qid);
  const box = $(`edit-q-${qid}`);
  if (!box) return;
  if (!STORY_CACHE) { try { STORY_CACHE = (await api('/api/stories')).stories; } catch { STORY_CACHE = []; } }
  const linked = new Set((q.stories || []).map((s) => s.id));
  box.classList.remove('hidden');
  box.innerHTML = `
    <label class="flabel">Question</label>
    <textarea class="eq-question">${esc(q.question)}</textarea>
    <label class="flabel">Category</label>
    <select class="eq-cat">${CATEGORIES.map((c) => `<option ${c === q.category ? 'selected' : ''}>${c}</option>`).join('')}</select>
    <label class="flabel">My answer (markdown)</label>
    <textarea class="eq-answer" placeholder="Talking points…">${esc(q.my_answer_md ?? '')}</textarea>
    <label class="flabel">Linked stories</label>
    <div class="eq-stories">${STORY_CACHE.length
      ? STORY_CACHE.map((s) => `<label class="cl-item"><input type="checkbox" class="eq-story" value="${s.id}" ${linked.has(s.id) ? 'checked' : ''}> <span>${esc(s.title)}</span></label>`).join('')
      : '<span class="muted sm">No stories in the library yet.</span>'}</div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <button class="sm primary" data-save-q="${qid}">Save</button>
      <button class="sm ghost" data-cancel-q="${qid}">Cancel</button>
      <span class="spacer"></span>
      <button class="sm ghost danger" data-archive-q="${qid}">Archive</button>
    </div>`;
}

async function saveQuestion(qid) {
  const box = $(`edit-q-${qid}`);
  try {
    await jsonPatch(`/api/questions/${qid}`, {
      question: box.querySelector('.eq-question').value.trim(),
      category: box.querySelector('.eq-cat').value,
      my_answer_md: box.querySelector('.eq-answer').value,
    });
    const ids = [...box.querySelectorAll('.eq-story:checked')].map((c) => Number(c.value));
    await jsonPut(`/api/questions/${qid}/stories`, { story_ids: ids });
    toast('Saved');
    await renderDrill(OPP_ID);
  } catch (e) { toast(e.message); }
}

// ======================= STORIES =======================
let STORIES_TAG = 'all';

async function renderStories() {
  app().innerHTML = `<div class="empty">Loading stories…</div>`;
  let data;
  try { data = await api('/api/stories'); }
  catch (e) { app().innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  STORY_CACHE = data.stories;

  const tags = [...new Set(data.stories.flatMap((s) => s.tags))].sort();
  if (STORIES_TAG !== 'all' && !tags.includes(STORIES_TAG)) STORIES_TAG = 'all';
  const shown = data.stories.filter((s) => STORIES_TAG === 'all' || s.tags.includes(STORIES_TAG));

  const cardHTML = (s) => `
    <div class="scard" data-sid="${s.id}">
      <div class="scard-head">
        <span class="scard-title">${esc(s.title)}</span>
        <span class="spacer"></span>
        ${s.usage_count ? `<span class="badge">${s.usage_count} question${s.usage_count > 1 ? 's' : ''}</span>` : ''}
        <button class="sm ghost" data-edit-story="${s.id}">Edit</button>
      </div>
      ${s.tags.length ? `<div class="scard-tags">${s.tags.map((t) => `<span class="chip">${esc(t)}</span>`).join(' ')}</div>` : ''}
      <div class="scard-body">${starHTML(s)}</div>
      <div class="scard-edit hidden" id="edit-story-${s.id}"></div>
    </div>`;

  app().innerHTML = `
    <div class="toolbar">
      <button class="sm" data-nav="${OPP_ID ? `#/opp/${OPP_ID}/briefing` : '#/'}">← Back</button>
      <span class="cat-chips">
        ${['all', ...tags].map((t) => `<button class="cat-chip ${STORIES_TAG === t ? 'active' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}
      </span>
      <span class="spacer"></span>
      <button class="primary" id="add-story-btn">＋ New story</button>
    </div>
    <div id="new-story-box" class="scard hidden"><div class="scard-edit" id="edit-story-new"></div></div>
    <div class="scards">${shown.map(cardHTML).join('') || '<div class="empty">No stories yet — your STAR bank starts here.</div>'}</div>`;

  $('add-story-btn').onclick = () => {
    $('new-story-box').classList.remove('hidden');
    openStoryEditor('new');
  };
}

function openStoryEditor(sid) {
  const s = sid === 'new' ? {} : STORY_CACHE.find((x) => x.id === Number(sid)) || {};
  const box = $(`edit-story-${sid}`);
  if (!box) return;
  box.classList.remove('hidden');
  const ta = (cls, label, val, ph = '') =>
    `<label class="flabel">${label}</label><textarea class="${cls}" placeholder="${ph}">${esc(val ?? '')}</textarea>`;
  box.innerHTML = `
    <label class="flabel">Title</label><input type="text" class="es-title" value="${esc(s.title ?? '')}" placeholder="The lost Q3 platform deal">
    ${ta('es-situation', 'Situation', s.situation_md)}
    ${ta('es-task', 'Task', s.task_md)}
    ${ta('es-action', 'Action', s.action_md)}
    ${ta('es-result', 'Result', s.result_md)}
    ${ta('es-body', 'Freeform (instead of / alongside STAR)', s.body_md)}
    <label class="flabel">Tags (comma-separated)</label><input type="text" class="es-tags" value="${esc((s.tags || []).join(', '))}" placeholder="lost-deal, negotiation">
    <div style="display:flex;gap:8px;margin-top:8px">
      <button class="sm primary" data-save-story="${sid}">Save</button>
      <button class="sm ghost" data-cancel-story="${sid}">Cancel</button>
      <span class="spacer"></span>
      ${sid !== 'new' ? `<button class="sm ghost danger" data-archive-story="${sid}">Archive</button>` : ''}
    </div>`;
  box.querySelector('.es-title').focus();
}

async function saveStory(sid) {
  const box = $(`edit-story-${sid}`);
  const val = (cls) => box.querySelector(`.${cls}`).value;
  const payload = {
    title: val('es-title').trim(),
    situation_md: val('es-situation'), task_md: val('es-task'),
    action_md: val('es-action'), result_md: val('es-result'), body_md: val('es-body'),
    tags: val('es-tags').split(',').map((t) => t.trim()).filter(Boolean),
  };
  if (!payload.title) { toast('Title required'); return; }
  try {
    if (sid === 'new') await jsonPost('/api/stories', payload);
    else await jsonPatch(`/api/stories/${sid}`, payload);
    toast('Story saved');
    renderStories();
  } catch (e) { toast(e.message); }
}

// ======================= event delegation =======================
document.addEventListener('click', (e) => {
  const t = (sel) => e.target.closest(sel);

  const nav = t('[data-nav]');
  if (nav) { location.hash = nav.dataset.nav; return; }
  const togAll = t('[data-toggle-all]');
  if (togAll) { showAll = true; localStorage.setItem('at-show-all', '1'); renderHome(); return; }
  const ocard = t('.ocard');
  if (ocard && !e.target.closest('a,button')) { location.hash = `#/opp/${ocard.dataset.opp}/briefing`; return; }

  // briefing
  const editB = t('[data-edit-brief]');
  if (editB) return editBrief(editB.dataset.editBrief);
  const saveB = t('[data-save-brief]');
  if (saveB) return saveBrief(saveB.dataset.saveBrief);
  if (t('[data-cancel-brief]')) return renderBriefingTab();
  const addB = t('[data-add-brief]');
  if (addB) {
    const name = prompt('Section name (e.g. questions_for_them, logistics, notes):');
    if (!name) return;
    const sec = name.trim().toLowerCase().replace(/\s+/g, '_');
    if (!BRIEFING.briefs.find((r) => r.section === sec)) BRIEFING.briefs.push({ section: sec, title: null, body_md: '' });
    renderBriefingTab();
    return editBrief(sec);
  }
  const inst = t('[data-instantiate]');
  if (inst) {
    api('/api/checklist-templates').then((d) => {
      const tpl = d.templates[0];
      if (!tpl) return toast('No checklist template found');
      return jsonPost(`/api/opportunities/${OPP_ID}/checklist/instantiate`, { template_id: tpl.id })
        .then((r) => { toast(`${r.added} item(s) added`); return api(`/api/opportunities/${OPP_ID}/briefing`); })
        .then((b) => { BRIEFING = b; renderBriefingTab(); });
    }).catch((err) => toast(err.message));
    return;
  }
  if (e.target.matches?.('input[data-check]')) {
    const chk = e.target;
    jsonPatch(`/api/checklist-items/${chk.dataset.check}`, { done: chk.checked })
      .then(() => api(`/api/opportunities/${OPP_ID}/briefing`))
      .then((b) => { BRIEFING = b; renderBriefingTab(); })
      .catch((err) => toast(err.message));
    return;
  }
  const delC = t('[data-del-check]');
  if (delC) {
    e.preventDefault();
    api(`/api/checklist-items/${delC.dataset.delCheck}`, { method: 'DELETE' })
      .then(() => api(`/api/opportunities/${OPP_ID}/briefing`))
      .then((b) => { BRIEFING = b; renderBriefingTab(); })
      .catch((err) => toast(err.message));
    return;
  }

  // drill
  const dcat = t('[data-drill-cat]');
  if (dcat) { DRILL.cat = dcat.dataset.drillCat; buildDeck(); return DRILL.bank ? renderBank() : renderDeckCard(); }
  if (t('[data-drill-shuffle]')) { DRILL.shuffle = !DRILL.shuffle; buildDeck(); return renderDeckCard(); }
  if (t('[data-drill-bank]')) { DRILL.bank = !DRILL.bank; return DRILL.bank ? renderBank() : (buildDeck(), renderDeckCard()); }
  if (t('[data-drill-reveal]')) { DRILL.revealed = true; return renderDeckCard(); }
  if (t('[data-drill-skip]')) { DRILL.idx++; DRILL.revealed = false; return renderDeckCard(); }
  if (t('[data-drill-restart]')) { buildDeck(); return renderDeckCard(); }
  const grade = t('[data-drill-grade]');
  if (grade) return drillGrade(grade.dataset.drillGrade);
  const banter = t('[data-drill-banter]');
  if (banter) return drillBanter(Number(banter.dataset.drillBanter), banter);

  // bank
  const editQ = t('[data-edit-q]');
  if (editQ) return openQuestionEditor(Number(editQ.dataset.editQ));
  const saveQ = t('[data-save-q]');
  if (saveQ) return saveQuestion(Number(saveQ.dataset.saveQ));
  const cancelQ = t('[data-cancel-q]');
  if (cancelQ) { const b = $(`edit-q-${cancelQ.dataset.cancelQ}`); if (b) { b.classList.add('hidden'); b.innerHTML = ''; } return; }
  const archQ = t('[data-archive-q]');
  if (archQ) {
    if (!confirm('Archive this question? Its drill history is kept.')) return;
    jsonPatch(`/api/questions/${archQ.dataset.archiveQ}`, { archived: true })
      .then(() => renderDrill(OPP_ID)).catch((err) => toast(err.message));
    return;
  }

  // stories
  const tag = t('[data-tag]');
  if (tag) { STORIES_TAG = tag.dataset.tag; return renderStories(); }
  const editS = t('[data-edit-story]');
  if (editS) return openStoryEditor(editS.dataset.editStory);
  const saveS = t('[data-save-story]');
  if (saveS) return saveStory(saveS.dataset.saveStory);
  const cancelS = t('[data-cancel-story]');
  if (cancelS) {
    if (cancelS.dataset.cancelStory === 'new') { $('new-story-box').classList.add('hidden'); return; }
    return renderStories();
  }
  const archS = t('[data-archive-story]');
  if (archS) {
    if (!confirm('Archive this story?')) return;
    api(`/api/stories/${archS.dataset.archiveStory}`, { method: 'DELETE' })
      .then(() => renderStories()).catch((err) => toast(err.message));
    return;
  }
});

// Lazy-load linked stories when a drill card's <details> opens.
document.addEventListener('toggle', (e) => {
  const det = e.target;
  if (det.matches?.('.story-inline') && det.open) loadStoryInline(det);
}, true);

// ======================= routing =======================
async function route() {
  const opp = location.hash.match(/^#\/opp\/(\d+)\/(briefing|drill)$/);
  if (opp) return renderOpportunity(Number(opp[1]), opp[2]);
  if (location.hash === '#/stories') return renderStories();
  OPP_ID = null;
  return renderHome();
}

window.addEventListener('hashchange', route);
route();
