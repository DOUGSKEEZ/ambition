// engineer SPA — vanilla JS, same-origin fetch, Chart.js (vendored) for rendering.
const $ = (id) => document.getElementById(id);

// --- Theme + cross-app links (shared chrome with Sniper/Medic) ---
(function initChrome() {
  const host = location.hostname;
  const medic = $('link-medic'); if (medic) medic.href = `${location.protocol}//${host}:7701/`;
  const sniper = $('link-sniper'); if (sniper) sniper.href = `${location.protocol}//${host}:7700/`;
  const btn = $('theme-toggle');
  const sync = () => { btn.textContent = document.documentElement.getAttribute('data-theme') === 'light' ? '☀️' : '🌙'; };
  if (btn) {
    sync();
    btn.onclick = () => {
      const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('theme', next);
      sync();
      redrawCurrent(); // re-render the active view's chart so colours track the theme
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

const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

// Canonical contact-type colours, matched to the type badges used across the suite, plus a
// fixed display order so the stacks read the same every time. Anything outside this set
// (e.g. company names) cycles the palette below.
const TYPE_META = {
  hiring_manager: { label: 'Hiring Manager', color: '#ff5c5c' },
  recruiter:      { label: 'Recruiter',      color: '#34c759' },
  peer:           { label: 'Peer',           color: '#4f8cff' },
  unknown:        { label: 'Unknown',        color: '#9aa3b2' },
};
const TYPE_ORDER = ['hiring_manager', 'recruiter', 'peer', 'unknown'];
// Position in the canonical stack order; unrecognized/legacy types sort to the end.
const typeRank = (k) => { const j = TYPE_ORDER.indexOf(k); return j < 0 ? TYPE_ORDER.length : j; };
// Company colours deliberately lead with hues NOT used by the contact-type palette (no
// red/green/blue) so the Type and Company views don't read as related. Cycles if needed.
const COMPANY_PALETTE = ['#a78bfa', '#22d3ee', '#fb923c', '#e879f9', '#84cc16', '#38bdf8', '#f59e0b', '#2dd4bf', '#fb7185', '#c084fc', '#60a5fa', '#4ade80'];

// Contact-lifecycle funnel stages, in order, with display labels.
const STAGE_ORDER = ['captured', 'active', 'in_campaign', 'touched', 'responded'];
const STAGE_LABEL = { captured: 'Captured', active: 'Active', in_campaign: 'In campaign', touched: 'Touched', responded: 'Responded' };

// --- state ---
let companies = [];
let companyId = 'all';      // 'all' or a company id
let segment = 'type';        // 'type' | 'company'
let granularity = 'day';     // 'day' | 'week'
let current = null;          // last /metrics/outbound response actually rendered
let chart = null;
let reqSeq = 0;              // monotonic token — guards against out-of-order responses
let appliedCompanyId = 'all'; // the companyId reflected in `current` (for control re-sync)

let currentView = 'outbound'; // 'outbound' | 'funnel'
// Funnel view has its own segment + render state, independent of Outbound's.
let fnSegment = 'type';
let fnCurrent = null;
let fnChart = null;
let fnSeq = 0;
let fnAppliedCompanyId = 'all';

// ---------- bootstrap ----------
async function loadCompanies() {
  companies = await api('/companies');
  const sel = $('company');
  sel.innerHTML = '';
  const all = document.createElement('option');
  all.value = 'all'; all.textContent = 'All companies';
  sel.appendChild(all);
  for (const c of companies) {
    const o = document.createElement('option');
    o.value = c.id; o.textContent = `${c.name} (${c.active_contacts})`;
    sel.appendChild(o);
  }
  sel.value = 'all';
}

// ---------- data ----------
async function loadOutbound() {
  const seq = ++reqSeq;
  const reqCompanyId = companyId;
  const parts = [`granularity=${granularity}`, `segment=${segment}`];
  if (reqCompanyId !== 'all') parts.push(`company_id=${reqCompanyId}`);
  let resp;
  try {
    resp = await api(`/metrics/outbound?${parts.join('&')}`);
  } catch (e) {
    if (seq === reqSeq) { toast(e.message); syncControls(); } // snap the toolbar back to what's shown
    return;
  }
  if (seq !== reqSeq) return; // a newer request started while this was in flight — drop it
  current = resp;
  appliedCompanyId = reqCompanyId;
  draw();
  syncControls();
}

// Keep the toolbar honest: make every control reflect exactly what's rendered. The source of
// truth is the last good response (which echoes granularity + segment) plus the companyId it
// used. Called after a successful draw and after a failed fetch, so a control never advertises
// a selection the chart isn't actually showing.
function syncControls() {
  segment = current ? current.segment : segment;
  granularity = current ? current.granularity : granularity;
  companyId = appliedCompanyId;
  setSegActive('seg-segment', segment);
  setSegActive('seg-granularity', granularity);
  $('company').value = appliedCompanyId === 'all' ? 'all' : String(appliedCompanyId);
}
function setSegActive(id, v) {
  $(id).querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === v));
}

// Pivot tidy rows [{period, seg_key, count}] into ordered periods + one dataset per segment
// key, zero-filling periods a key didn't appear in so the stacks line up.
function pivot(rows, seg) {
  const periods = [...new Set(rows.map((r) => r.period))].sort();
  const pIdx = Object.fromEntries(periods.map((p, i) => [p, i]));
  const keys = [...new Set(rows.map((r) => r.seg_key))];
  const totals = {};
  for (const r of rows) totals[r.seg_key] = (totals[r.seg_key] || 0) + r.count;
  // Stable order: known types by canonical rank (unknown/legacy last); companies by total desc.
  keys.sort(seg === 'type'
    ? (a, b) => typeRank(a) - typeRank(b)
    : (a, b) => totals[b] - totals[a]);
  const series = keys.map((k, i) => {
    const data = new Array(periods.length).fill(0);
    for (const r of rows) if (r.seg_key === k) data[pIdx[r.period]] = r.count;
    // Unknown/legacy types keep their raw label but fall back to the muted 'unknown' colour.
    const meta = seg === 'type' ? (TYPE_META[k] || { label: k, color: TYPE_META.unknown.color }) : null;
    return { key: k, label: meta ? meta.label : k, color: meta ? meta.color : COMPANY_PALETTE[i % COMPANY_PALETTE.length], data, total: totals[k] };
  });
  return { periods, series, total: Object.values(totals).reduce((a, b) => a + b, 0) };
}

function periodLabel(p) {
  const d = new Date(`${p}T00:00:00`);
  if (granularity === 'week') return `Wk ${d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' })}`;
  // Day view leads with the weekday (e.g. "Thu, Jun 04") so weekday cadence is legible.
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: '2-digit' });
}

function renderStats(piv) {
  const strip = $('stat-strip');
  const total = `<div class="stat total"><div class="v">${piv.total}</div><div class="k">Total sent</div></div>`;
  const segs = piv.series
    .filter((s) => s.total > 0)
    .map((s) => `<div class="stat"><div class="v">${s.total}</div><div class="k"><span class="swatch" style="background:${s.color}"></span>${esc(s.label)}</div></div>`)
    .join('');
  strip.innerHTML = total + segs;
}

// (Re)create the chart from `current`, reading theme colours fresh each time.
function draw() {
  if (!current) return;
  const piv = pivot(current.rows, current.segment);
  const hasData = piv.total > 0;
  $('outbound-empty').classList.toggle('hidden', hasData);
  $('range-note').textContent = hasData
    ? `${piv.total} sent · ${piv.periods.length} ${granularity === 'week' ? 'week' : 'day'}${piv.periods.length === 1 ? '' : 's'} with activity`
    : '';
  renderStats(piv);

  const grid = cssVar('--border');
  const tick = cssVar('--muted');
  if (chart) { chart.destroy(); chart = null; }
  if (!hasData) return;

  chart = new Chart($('outbound-chart').getContext('2d'), {
    type: 'bar',
    data: {
      labels: piv.periods.map(periodLabel),
      datasets: piv.series.map((s) => ({ label: s.label, data: s.data, backgroundColor: s.color, borderWidth: 0, borderRadius: 3 })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      scales: {
        x: { stacked: true, grid: { color: grid }, ticks: { color: tick } },
        y: { stacked: true, beginAtZero: true, grid: { color: grid }, ticks: { color: tick, precision: 0 } },
      },
      plugins: {
        legend: { labels: { color: tick, boxWidth: 12 } },
        tooltip: { mode: 'index', intersect: false },
      },
    },
  });
}

// ---------- Funnel view ----------
async function loadFunnel() {
  const seq = ++fnSeq;
  const reqCompanyId = companyId;
  const parts = [`segment=${fnSegment}`];
  if (reqCompanyId !== 'all') parts.push(`company_id=${reqCompanyId}`);
  let resp;
  try {
    resp = await api(`/metrics/funnel?${parts.join('&')}`);
  } catch (e) {
    if (seq === fnSeq) { toast(e.message); syncFunnelControls(); }
    return;
  }
  if (seq !== fnSeq) return;
  fnCurrent = resp;
  fnAppliedCompanyId = reqCompanyId;
  drawFunnel();
  syncFunnelControls();
}

function syncFunnelControls() {
  fnSegment = fnCurrent ? fnCurrent.segment : fnSegment;
  setSegActive('fn-seg-segment', fnSegment);
  // companyId is the shared global picker; keep it pointing at what's rendered.
  companyId = fnAppliedCompanyId;
  $('company').value = fnAppliedCompanyId === 'all' ? 'all' : String(fnAppliedCompanyId);
}

// Pivot funnel rows [{stage, seg_key, count}] into ordered stages + one dataset per segment
// key. Like pivot() but the buckets are the fixed lifecycle stages, not dates.
function funnelPivot(rows, seg) {
  // Always show the full fixed lifecycle axis (zero-filling stages with no rows) so the funnel
  // and the adjacent-stage conversion math stay meaningful even when a stage is empty.
  const stages = STAGE_ORDER.slice();
  const sIdx = Object.fromEntries(stages.map((s, i) => [s, i]));
  const keys = [...new Set(rows.map((r) => r.seg_key))];
  const totals = {};
  for (const r of rows) totals[r.seg_key] = (totals[r.seg_key] || 0) + r.count;
  keys.sort(seg === 'type'
    ? (a, b) => typeRank(a) - typeRank(b)
    : (a, b) => totals[b] - totals[a]);
  const series = keys.map((k, i) => {
    const data = new Array(stages.length).fill(0);
    for (const r of rows) if (r.seg_key === k) data[sIdx[r.stage]] = r.count;
    const meta = seg === 'type' ? (TYPE_META[k] || { label: k, color: TYPE_META.unknown.color }) : null;
    return { label: meta ? meta.label : k, color: meta ? meta.color : COMPANY_PALETTE[i % COMPANY_PALETTE.length], data };
  });
  const stageTotals = stages.map((_, i) => series.reduce((a, s) => a + s.data[i], 0));
  return { stages, stageLabels: stages.map((s) => STAGE_LABEL[s] || s), series, stageTotals };
}

// Stat strip: each stage's headcount + its conversion from the previous stage, so the
// leakiest step is obvious at a glance.
function renderFunnelStats(piv) {
  const strip = $('fn-stat-strip');
  strip.innerHTML = piv.stages.map((_, i) => {
    const tot = piv.stageTotals[i];
    const prev = i > 0 ? piv.stageTotals[i - 1] : null;
    // Stages are strictly nested server-side, so this ratio is always 0–100%. Guard prev=0.
    const sub = i === 0 ? 'sourced' : (prev > 0 ? `${Math.round((100 * tot) / prev)}% of prev` : '—');
    const klass = i === 0 ? 'stat total' : 'stat';
    return `<div class="${klass}"><div class="v">${tot}</div><div class="k">${esc(piv.stageLabels[i])}</div><div class="k" style="text-transform:none;letter-spacing:0">${sub}</div></div>`;
  }).join('');
}

function drawFunnel() {
  if (!fnCurrent) return;
  const piv = funnelPivot(fnCurrent.rows, fnCurrent.segment);
  const hasData = (piv.stageTotals[0] || 0) > 0;
  $('funnel-empty').classList.toggle('hidden', hasData);
  renderFunnelStats(piv);

  const grid = cssVar('--border');
  const tick = cssVar('--muted');
  if (fnChart) { fnChart.destroy(); fnChart = null; }
  if (!hasData) return;

  fnChart = new Chart($('funnel-chart').getContext('2d'), {
    type: 'bar',
    data: {
      labels: piv.stageLabels,
      datasets: piv.series.map((s) => ({ label: s.label, data: s.data, backgroundColor: s.color, borderWidth: 0, borderRadius: 3 })),
    },
    options: {
      indexAxis: 'y', // horizontal bars read as a funnel top-to-bottom
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      scales: {
        x: { stacked: true, beginAtZero: true, grid: { color: grid }, ticks: { color: tick, precision: 0 } },
        y: { stacked: true, grid: { color: grid }, ticks: { color: tick } },
      },
      plugins: {
        legend: { labels: { color: tick, boxWidth: 12 } },
        tooltip: { mode: 'index', intersect: false },
      },
    },
  });
}

// ---------- view switching ----------
function show(view) {
  currentView = view;
  $('view-outbound').classList.toggle('hidden', view !== 'outbound');
  $('view-funnel').classList.toggle('hidden', view !== 'funnel');
  $('tab-outbound').classList.toggle('active', view === 'outbound');
  $('tab-funnel').classList.toggle('active', view === 'funnel');
}
function reloadCurrent() { return currentView === 'outbound' ? loadOutbound() : loadFunnel(); }
function redrawCurrent() { return currentView === 'outbound' ? draw() : drawFunnel(); }

// ---------- wiring ----------
function wireSeg(id, onPick) {
  $(id).querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      $(id).querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      onPick(b.dataset.v);
    };
  });
}
wireSeg('seg-segment', (v) => { segment = v; loadOutbound(); });
wireSeg('seg-granularity', (v) => { granularity = v; loadOutbound(); });
wireSeg('fn-seg-segment', (v) => { fnSegment = v; loadFunnel(); });
$('tab-outbound').onclick = () => { show('outbound'); loadOutbound(); };
$('tab-funnel').onclick = () => { show('funnel'); loadFunnel(); };
$('company').onchange = (e) => { companyId = e.target.value === 'all' ? 'all' : Number(e.target.value); reloadCurrent(); };

(async function init() {
  try {
    await loadCompanies();
    await loadOutbound();
  } catch (e) { toast(e.message); }
})();
