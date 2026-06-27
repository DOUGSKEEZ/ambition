# Ambition CRM

A small squad of local tools _leveraging AI_ for running a sharp, high-volume, **honest** job-search campaign at AI-native companies. 
Each app owns one job — recon, outreach, ideas, command — and they share one Postgres database and one set of LLM endpoints.  
LLM calls go either to my local CLio LLM or a 3rd party Foundation Model.

The metaphor is a game squad. Six independently hosted roles:

| Role | App | Job | Status |
|------|-----|-----|--------|
| 🎯 **Sniper** | [`sniper/`](sniper/) | Acquire targets — capture a LinkedIn profile into a reviewed contact record with AI summary | **Shipped** · :7700 |
| 🩹 **Medic** | [`meddic/`](meddic/) | Keep the campaign alive — run customized outreach sequences and track every touch | **Shipped** · :7701 |
| 🔧 **Engineer** | [`engineer/`](engineer/) | Metrics for optimization — charts of my outbound flow (by type & company) to tune the campaign | **Shipped** · :7702 |
| ⭐ **Commander** | [`commander/`](commander/) | Strategic Company Overview — aggregate target company news, events, and other informationinto one strategic view | **Planned** |
| 🎖 **SpecOps** | [`specops/`](specops/) | Convert & prep — a Kanban board of live opportunities (comp, location, target HMs, stage) once an HM engages | **Shipped** · :7703 |
| 🛰 **UAV** | [`uav/`](uav/) | Radar — daily scan of target companies' job boards for new/closed roles, with application aging (re-apply every 7–14 days) | **Shipped** · :7704 |

---

## 🎯 Sniper — target acquisition

Turns a LinkedIn profile I find **from in my browser** into a staged contact record: deterministic fields parsed from the page plus type-specific AI notes, reviewed and approved
in a small local web UI. 

Two Parts:
- Browser Extension 
- WebUI for shipping to pipeline

NOTE: There is NO scraping infrastructure and no account risk.  It uses AI to summarize and retrieve what I see when I view a linkedin profile.

Shipped and in daily use. Full docs: [`sniper/README.md`](sniper/README.md).

## 🩹 Medic — keep the outreach alive

The outreach engine over Sniper's contacts. Two halves:

- **Campaigns** — reusable skeleton sequences (named, categorized, goal-oriented, ordered steps across channels: email, LinkedIn, call, text, voice/video memo).
- **Pipeline** — a **Today** work queue (who's due, sorted by heat, flagged when going cold), a **Tomorrow** look-ahead, a **Roster**, and per-contact detail. Assigning a campaign *copies* its steps into an editable per-person run; marking a step sent advances the sequence and suggests the next date.

A **drafting layer** assembles my voice context plus the contact's notes and the step's purpose, then writes a first draft via a local model (qwen3) or Claude — always a starting point I edit, **NEVER** auto-sent.

The name is closer to the truth than a pun. Medic runs the **MEDDIC** qualification loop, repurposed from enterprise-sales deal-qualification to a job search — the "deal" is getting hired, the "buyer" is a target AI company:

- **Metrics** — my quantified proof points, selected per contact (and, soon, analytics on the outreach itself — an Engineer item).
- **Economic Buyer** — surfaced as the campaign works up from recruiters and peers toward the hiring manager who can actually say yes.
- **Decision Criteria** — what the role and company need, captured in the contact's notes and AI summary.
- **Decision Process** — the interview path; lightly tracked today, a natural support area to build out.
- **Identify Pain** — the company need I solve, found in notes and projected into the campaign's angle.
- **Champion** — every contact is a potential internal advocate; the relationship-building process is how they're found.

Shipped 2026-05-31. Lives in [`meddic/`](meddic/) (the directory keeps the original `meddic` name).

## 🔧 Engineer — Analytics/Metrics

Charts and metrics over what the squad does, so I can tune the campaign on data instead of vibes. **Shipped — two views:** *Outbound* (touches over time, stacked by contact type or company, day/week toggle, company filter) and *Funnel* (the contact lifecycle Captured → Active → In&nbsp;campaign → Touched → Responded, stacked by type/company, with per-stage conversions — the empty next rung is the SpecOps/Opportunity stage). (Read-only over the shared DB; charts render with a locally-vendored Chart.js, nothing leaves the box.) What's next — engagement/outcome tracking, a daily momentum read — lives in [`engineer/engineer-plan.md`](engineer/engineer-plan.md).

## ⭐ Commander — the strategic view

This is the page that rolls up the **target companies** selected — the company-level view above the individual contacts. Where Sniper and Medic operate one person at a time, the Commander answers "which companies am I working, how deep am I into each, and where should I push next?" Its home is [`commander/`](commander/); see the stub there for the current sketch.

## 🎖 SpecOps — convert & prep

Where Medic runs top-of-funnel outreach, SpecOps takes over once a hiring manager engages. **Shipped:** a **Kanban board** of opportunities, dragged across the pipeline (Pending Apply → Applied / Staged → Pending Draft → Sent / Drafted → HM Reply → Screen & Interview → Decision). Each opportunity anchors on a company (the only required field — a role may be unlisted, so the title is a freeform placeholder and the posting URL is optional), tracks comp / location / first-message & first-reply dates / notes, and links **multiple target HMs** (often a guess) with one markable as primary — the HM *is* the champion of that application. It introduces the **Opportunity** entity the rest of the system lacked, which is also the correlation backbone Engineer will chart against. Interview-prep assembly is the next iteration. See [`specops/specops-plan.md`](specops/specops-plan.md).

## 🛰 UAV — the job-board radar

A "minimap" that watches target companies' job boards so a role can't open (or close) without me
knowing. Two halves:

- **Pipeline** — a scheduled run (systemd user timer, ~7am) that fetches each configured board,
  filters to the roles I care about, diffs against what it saw last time, and emails a digest of
  **new / closed** roles plus anything **due for re-application**.
- **Radar UI** (:7704) — open roles grouped by company, each with an **application control**: mark a
  role applied and it starts an aging timer (amber at 7 days, red at 14) so I re-apply every 7–14
  days to stay fresh in the pool. An activity panel shows the open/close/apply history.

Provider-agnostic by design: each company is one config entry naming an **adapter** (Greenhouse for
Anthropic, Ashby for OpenAI, …) plus generic filter rules (title contains / required
department·office·team·location). Adding a company is a config append, not a code change. Owns the
`job_postings` + `uav_events` tables in the shared DB. See [`uav/uav-plan.md`](uav/uav-plan.md) and
[`uav/systemd/README.md`](uav/systemd/README.md).

---

## Quick start

The shipped apps are Node 22 ESM + Express serving a vanilla-JS SPA, backed by a shared Postgres database (named `sniper`). Bring up all dev servers in one tmux session:

```bash
./start-ambition.sh      # sniper :7700 + meddic :7701 + engineer :7702 + specops :7703 + uav :7704, one window each
./kill-ambition.sh       # stop all
```

- Sniper review UI → <http://localhost:7700/>
- Medic pipeline → <http://localhost:7701/>
- Engineer analytics → <http://localhost:7702/>
- SpecOps board → <http://localhost:7703/>
- UAV radar → <http://localhost:7704/>

First-time setup for each app is `npm install` + `.env` (and `npm run migrate` for the apps that own tables — Sniper, Medic, SpecOps, UAV). All share Sniper's `sniper` database; Medic and SpecOps also serve Sniper's contact photos, so set Sniper up first.

## Shared infrastructure

- **Database** — one Postgres database, `sniper`, on the samwise host. Sniper owns the identity/enrichment columns; Medic owns the tracker columns (`status`, `hot_cold`, `next_action_date`, campaign tables).  Neither writes the other's columns; `my_notes` is the one shared field.
- **Inference** — local qwen3 endpoints (30B / 4B, cross-VLAN) by default, with Claude as an opt-in provider via `ANTHROPIC_API_KEY`. Configured per app in `.env`.

## Layout

```
ambition/
├── sniper/        🎯 LinkedIn capture → enrichment → review  (shipped)
├── meddic/        🩹 campaign engine & outreach tracker      (shipped)
├── engineer/      🔧 analytics dashboard (outbound charts)    (shipped :7702)
├── commander/     ⭐ company rollup view                      (planned)
├── specops/       🎖 opportunity Kanban board                 (shipped :7703)
├── uav/           🛰 job-board radar + application aging       (shipped :7704)
├── start-ambition.sh / kill-ambition.sh
```
