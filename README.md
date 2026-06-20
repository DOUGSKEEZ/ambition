# Ambition CRM

A small squad of local tools _leveraging AI_ for running a sharp, high-volume, **honest** job-search campaign at AI-native companies. 
Each app owns one job — recon, outreach, ideas, command — and they share one Postgres database and one set of LLM endpoints.  
LLM calls go either to my local CLio LLM or a 3rd party Foundation Model.

The metaphor is a game squad. Five independently hosted roles:

| Role | App | Job | Status |
|------|-----|-----|--------|
| 🎯 **Sniper** | [`sniper/`](sniper/) | Acquire targets — capture a LinkedIn profile into a reviewed contact record with AI summary | **Shipped** · :7700 |
| 🩹 **Medic** | [`meddic/`](meddic/) | Keep the campaign alive — run customized outreach sequences and track every touch | **Shipped** · :7701 |
| 🔧 **Engineer** | [`engineer/`](engineer/) | Metrics for optimization — charts of my outbound flow (by type & company) to tune the campaign | **Shipped** · :7702 |
| ⭐ **Commander** | [`commander/`](commander/) | Strategic Company Overview — aggregate target company news, events, and other informationinto one strategic view | **Planned** |
| 🎖 **SpecOps** | [`specops/`](specops/) | Convert & prep — track live opportunities (comp, location, HM, stage) once an HM engages, and prep for the screen/interview | **Planned** |

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

Charts and metrics over what the squad does, so I can tune the campaign on data instead of vibes. **Shipped:** an *Outbound* dashboard — touches over time, stacked by contact type (HM / recruiter / peer) or by company, with a day/week toggle and a company filter. (Read-only over the shared DB; charts render with a locally-vendored Chart.js, nothing leaves the box.) What's next — engagement/outcome tracking, the conversion funnel, a daily momentum read — lives in [`engineer/engineer-plan.md`](engineer/engineer-plan.md).

## ⭐ Commander — the strategic view

This is the page that rolls up the **target companies** selected — the company-level view above the individual contacts. Where Sniper and Medic operate one person at a time, the Commander answers "which companies am I working, how deep am I into each, and where should I push next?" Its home is [`commander/`](commander/); see the stub there for the current sketch.

## 🎖 SpecOps — convert & prep

Where Medic runs top-of-funnel outreach, SpecOps takes over once a hiring manager engages: it tracks the live **opportunity** (job posting, comp range, location, the HM — who *is* the champion of that application — and the stage from screen to offer) and preps me for the interview. It introduces the one entity the rest of the system lacks — the Application/Opportunity — which is also the correlation backbone Engineer charts against. See [`specops/specops-plan.md`](specops/specops-plan.md).

---

## Quick start

The shipped apps are Node 22 ESM + Express serving a vanilla-JS SPA, backed by a shared Postgres database (named `sniper`). Bring up all dev servers in one tmux session:

```bash
./start-ambition.sh      # sniper :7700 + meddic :7701 + engineer :7702, one window each
./kill-ambition.sh       # stop all
```

- Sniper review UI → <http://localhost:7700/>
- Medic pipeline → <http://localhost:7701/>
- Engineer analytics → <http://localhost:7702/>

First-time setup for each app is in its own README (`npm install`, `createdb sniper` once, `npm run migrate`, `.env`). Medic shares Sniper's `sniper` database and serves Sniper's contact photos, so set Sniper up first.

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
├── specops/       🎖 opportunity tracking & interview prep    (planned)
├── start-ambition.sh / kill-ambition.sh
```
