# 🔧 Engineer — analytics & instrumentation backlog

Engineer owns the **measurement layer**: charts and metrics over what the squad does. Capture ideas here;
promote one to a build when it earns it.

Two facts that shape everything below:

1. **The data is high-integrity because it's all deliberate.** A touch is logged only when Doug marks it
   sent; a contact exists only because he imported it; a note exists only because he wrote it. No bot
   guessing — so the numbers can be trusted, unlike most auto-captured CRM telemetry.
2. **The apps store *state*, not *events*.** Tables hold the current value; `updated_at` moves on any
   edit. So every **"right now"** metric is free, but every **trend over time** is blocked until a history
   mechanism exists (see ⏳ below).

Tags: `[sniper]` `[meddic]` `[specops]` `[suite]`, size `quick`/`medium`/`big`, and `⚠ needs data` for an
idea blocked on schema that doesn't exist yet.

---

## ✅ Build now — no schema change

The headline charts Doug actually asked for, all computable from current tables.

- ✅ **SHIPPED (2026-06-19)** — **Outbound flow by contact type** — touches sent over time, stacked by
  HM / recruiter / peer **or** by company, with a day/week toggle and a company filter. Lives in the
  Engineer app (`/metrics/outbound`), bucketed to Doug's local day via `AT TIME ZONE`. *Was: build first.*
- ✅ **SHIPPED (2026-06-19)** — **Contact-lifecycle funnel** — Captured → Active → In campaign → Touched →
  Responded, stacked by type/company with a company filter and per-stage conversion (`/metrics/funnel`).
  Stages are strictly nested (cumulative flags) so the funnel can't invert. Snapshot of the *current active
  pipeline* — "Touched" here = sent on the active run, stricter than Outbound's all-time "sent". The empty
  stage after Responded is the SpecOps **Opportunity** entity (not built).
- `[meddic]` `medium` **Sequence-velocity funnel** — how fast a lead moves `captured_at` → run `started_at`
  → step 1 / 2 / 3 `sent_at`, with time-between-stages. A cohort funnel for the *outreach* half (the
  post-reply half belongs to SpecOps).
- `[meddic]` `quick` **Reply rate**, sliced by channel / contact type / campaign / company / step position —
  `response_received` ÷ `sent`.
- `[meddic]` `quick` **Time-to-first-reply** & **touches-to-response** — `response_at − sent_at`; count sent
  steps before the first `response_received` in a run. (`response_at` already exists.)
- `[meddic]` `quick` **Channel mix / send volume / active-day streak** — the activity pulse.
- `[suite]` `quick` **Depth per company & heat distribution (now)** — contacts by `type` per company;
  `hot_cold` counts. Snapshot only.
- `[suite]` `medium` **Morning-standup dashboard** — one page pulling the headline numbers together.

## ⚠ Needs new data

- `[suite]` `medium` ⏳ **History / event log** — an append-only `events` table (entity, field, old→new, `at`)
  or a nightly snapshot job. **Unlocks the entire trend tier**: backlog trend, heat movement, intake-over-time,
  the daily vibe index. Highest-leverage infra item; nearly every "over time" chart depends on it.
- `[meddic]` `quick` ⚠ **Engagement tiers, not a reply boolean** — rank signals: reply > profile view >
  *suspected* profile view. Keep "suspected" labeled soft so it never pollutes the hard reply-rate number.
- `[meddic]` `medium` ⚠ **Response outcomes as micro-events** — not a sentiment enum. Capture *(what they
  said) + (tag: qualifying question / referred to recruiter / soft pass / interested) + (next move: tailor
  step N / hold / advance)*. Doubles as the tailoring trigger. (Real example: an HM replying "SF or NY?" —
  that's a qualifying question worth recording and acting on, not a "positive/neutral/negative.")
- `[suite]` `big` ⏳ **Daily AI "vibe" index** — a local-LLM pass over the day's notes + outbound, emitting a
  momentum read, tracked over time. **OPEN QUESTION before building: what decision does it drive?** If it's
  "catch a slump and change channel mix," build it. If it's a feel-good gauge, it's noise. Needs the event
  log + an LLM pass.

## ➡ Belongs to SpecOps, not Engineer

- The **Opportunity / Application entity** (job posting, comp range, location, hiring manager = champion,
  stage, first-message / first-reply dates) is the post-reply funnel and the home of every rich correlation
  ("do SF roles reply faster?", "does comp band track stage?"). It's a data model, not a chart — so it lives
  in **[`../specops/specops-plan.md`](../specops/specops-plan.md)**. Engineer just visualizes it once it exists.

## ✗ Dropped (decided 2026-06-19)

- **Draft-source A/B** — all copy is human-written; the LLM is an ideation sidekick for breaking writer's
  block, not a drafter. Nothing to compare.
- **Generic MEDDIC champion flag / per-contact MEDDIC fields** — the hiring manager *is* the champion of each
  application by definition. That signal lives on the Opportunity (SpecOps), not as flags to hand-maintain.

---

## Inbox (other ideas)

- _(add ideas here)_

## Considered / Done

- _(move items here as they're thought through or shipped)_
