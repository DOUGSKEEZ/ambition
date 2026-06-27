# 🛰 UAV — job-board radar

A "minimap" over foundational-model companies' job boards. Two halves on one codebase:

1. **Pipeline** (`npm run pipeline`, run by a systemd user timer ~7am): fetch each configured board,
   filter to target roles, diff against the DB, email a digest of new/closed roles + roles due for
   re-application.
2. **Radar UI** (`npm run dev`, :7704): open roles grouped by company, per-role application tracking
   with an aging timer, and an activity history. A "Refresh now" button runs the same tracker
   on-demand (without emailing).

## Architecture

- **Provider adapters** (`src/providers/`): one module per ATS, each exporting `fetchJobs(source)`
  returning a normalized posting `{ jobId, title, url, location, groups:[{type,id?,name}], raw }`.
  Shipped: `greenhouse` (Anthropic), `ashby` (OpenAI). Add a provider = new file + register in
  `providers/index.js`.
- **Sources config** (`src/sources.js`): each company = `{ key, label, provider, endpoint|board,
  filter }`. Filters run on the normalized job: `titleContains` (case-insensitive substring, OR) and
  `requireGroups` (each `{type?,id?,name?}` must match a group; AND across entries). Adding a company
  is a config append.
- **Tracker** (`src/tracker.js`): the shared fetch→filter→diff core used by both the pipeline and
  `POST /api/refresh`. Per-source try/catch — a fetch failure skips that source's diff (never mass-
  closes on an outage). Upserts on `(source, job_id)`; reopened roles reuse their row. Writes
  `uav_events`. **Never touches application columns** — only the apply API does.
- **Storage**: shared `sniper` Postgres; UAV owns `job_postings` + `uav_events`
  (`database/migrations/001_uav.sql`). Reuses Sniper's `set_updated_at()` trigger.
- **Email** (`src/notify.js`): nodemailer over generic SMTP (defaults to Microsoft 365). Three
  sections — NEW / CLOSED / DUE FOR RE-APPLY. Best-effort: never throws, skipped if SMTP unset.

## Application aging

`applied_at` / `last_applied_at` / `application_count` on `job_postings`. `days_since_applied` is
computed in the API. Badge thresholds `REAPPLY_SOFT_DAYS` (amber, default 7) /`REAPPLY_HARD_DAYS`
(red, default 14). The digest's DUE FOR RE-APPLY section nudges applied+open roles past the soft
cadence.

## API

- `GET /api/config` — thresholds + sources.
- `GET /api/postings?status=open|closed|all&source=<key>` — postings + `days_since_applied`.
- `GET /api/events?limit=<n>` — recent activity.
- `POST /api/refresh` — run tracker now (no email).
- `POST /api/postings/:id/apply` · `POST /api/postings/:id/unapply`.

## Scheduling

User systemd timer — see [`systemd/README.md`](systemd/README.md). `OnCalendar=*-*-* 07:00:00`
(host-local TZ), `loginctl enable-linger samwise` so it fires without a login.
