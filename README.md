# Ambition

A small squad of local tools for running a sharp, high-volume, **honest** job-search campaign at AI-native companies. Each app owns one job — recon, outreach, ideas, command — and they share one Postgres database and one set of local/Claude inference endpoints. Everything runs on the `samwise` host; nothing is hosted, nothing leaves the box except the LLM calls I opt into.

The metaphor is a game squad. Four independently hosted roles:

| Role | App | Job | Status |
|------|-----|-----|--------|
| 🎯 **Sniper** | [`sniper/`](sniper/) | Acquire targets — capture a LinkedIn profile into a reviewed contact record | **Shipped** · :7700 |
| 🩹 **Medic** | [`meddic/`](meddic/) | Keep the campaign alive — run customized outreach sequences and track every touch | **Shipped** · :7701 |
| 🔧 **Engineer** | [`engineer/`](engineer/) | Improve the kit — a backlog of workflow / tooling ideas for the CRM | **Ideas space** |
| ⭐ **Commander** | [`commander/`](commander/) | Strategic Company Overview — aggregate target company news, events, and other informationinto one strategic view | **Planned** |

---

## 🎯 Sniper — target acquisition

Turns a LinkedIn profile I find **from in my browser** into a staged contact record: deterministic fields parsed from the page plus type-specific AI notes, reviewed and approved
in a small local web UI. Sniper never fetches LinkedIn itself — capture happens client-side via an MV3 extension, so there's no scraping infrastructure and no account risk.

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

Today the framework lives *implicitly*, in free-text notes and the campaign structure. Making it explicit — a per-company MEDDIC scorecard — is a strong candidate for the **Commander**.

Shipped 2026-05-31. Lives in [`meddic/`](meddic/) (the directory keeps the original `meddic` name).

## 🔧 Engineer — improve the kit

Planned Metrics and Analytics to track my effectiveness. See [`engineer/engineer-plan.md`](engineer/engineer-plan.md) for the running backlog. 

## ⭐ Commander — the strategic view

This is the page that rolls up the **target companies** selected — the company-level view above the individual contacts. Where Sniper and Medic operate one person at a time, the Commander answers "which companies am I working, how deep am I into each, and where should I push next?" Its home is [`commander/`](commander/); see the stub there for the current sketch.

---

## Quick start

Both shipped apps are Node 22 ESM + Express serving a vanilla-JS SPA, backed by a shared Postgres database (named `sniper`). Bring up both dev servers in one tmux session:

```bash
./start-ambition.sh      # sniper :7700 + meddic :7701, one tmux window each
./kill-ambition.sh       # stop both
```

- Sniper review UI → <http://localhost:7700/>
- Medic pipeline → <http://localhost:7701/>

First-time setup for each app is in its own README (`npm install`, `createdb sniper` once, `npm run migrate`, `.env`). Medic shares Sniper's `sniper` database and serves Sniper's contact photos, so set Sniper up first.

## Shared infrastructure

- **Database** — one Postgres database, `sniper`, on the samwise host. Sniper owns the identity/enrichment columns; Medic owns the tracker columns (`status`, `hot_cold`, `next_action_date`, campaign tables).  Neither writes the other's columns; `my_notes` is the one shared field.
- **Inference** — local qwen3 endpoints (30B / 4B, cross-VLAN) by default, with Claude as an opt-in provider via `ANTHROPIC_API_KEY`. Configured per app in `.env`.

## Layout

```
ambition/
├── sniper/        🎯 LinkedIn capture → enrichment → review  (shipped)
├── meddic/        🩹 campaign engine & outreach tracker      (shipped)
├── engineer/      🔧 ideas backlog for CRM improvements
├── commander/     ⭐ company rollup view                      (planned)
├── start-ambition.sh / kill-ambition.sh
```
