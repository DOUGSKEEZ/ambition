# 🎖 SpecOps — opportunity tracking & interview prep (planned)

Where Medic runs *top-of-funnel* outreach one contact at a time, SpecOps owns what happens **once a hiring
manager engages**: the live opportunity, the data around it, and prepping Doug for the screen and interview.
Medic hands off here at the first real HM reply.

## The core idea: the Opportunity entity

The structured fields Doug wants — comp, location, job posting, HM, message timeline — aren't more columns on
a *person*. They're a new entity: an **Application / Opportunity** (a specific role being pursued). It's the
correlation backbone the rest of the system lacks.

```
Opportunity
  company           → existing companies row
  job_posting       → url / title
  hiring_manager    → a people row (the HM IS the champion — no separate flag)
  comp_range
  location          → SF / NY / remote / …
  stage             → outreach → HM reply → screen → interview → onsite → offer
  first_message_at  → first touch to the HM
  first_reply_at    → first real reply from the HM
  notes / prep
```

This is the **post-reply half of the funnel** (Medic + Engineer cover the outreach half), and the home of
every rich correlation: do SF roles reply faster? does comp band track how far a stage gets? which campaign
angle converts to a screen, not just a reply?

## Why it's its own role

- **Champion = the HM, inherently.** Generic MEDDIC champion-flagging doesn't fit a job search; the HM of a
  given application is the champion. That relationship lives on the Opportunity, cleanly.
- **Different job than Medic.** Medic optimizes volume + reply rate. SpecOps optimizes *conversion* of a few
  live opportunities, plus interview readiness — a small number of high-stakes records, not a queue.

## Interview / screen prep (the "Support" half)

Beyond tracking: assemble per-opportunity prep — the job posting, the HM's background (from Sniper), Doug's
matching proof points, likely questions. Scope TBD; the data model above comes first.

## Status

**SHIPPED 2026-06-19** — Node + Express + vanilla-JS SPA on **:7703**, a Kanban board of opportunities.
Owns two tables in the shared `sniper` DB (`opportunities`, `opportunity_contacts`; migration
`database/migrations/001_opportunities.sql`). Cards drag across the 7 stages; a create/edit modal manages
the fields and attaches multiple target HMs (one primary). The chosen model differs from the original
sketch in two ways, per Doug's input: **multiple guessed HMs per role** (many-to-many join table, not a
single `hiring_manager_id`) and an **optional/placeholder job listing** (only the company is required).

Next iteration: the **interview-prep ("Support") half** above, and Engineer charts over this data (the
funnel's post-Responded stages + comp/location/stage correlations). See
[`../engineer/engineer-plan.md`](../engineer/engineer-plan.md).

## Open questions

- Is an Opportunity strictly one-per-(company, role), and can a person be the HM on more than one?
- Does Medic's "active run" end when an Opportunity opens, or do they run in parallel?
- Squad size: this makes five roles (Sniper, Medic, Engineer, Commander, SpecOps) — confirm the root README
  should grow to match.
