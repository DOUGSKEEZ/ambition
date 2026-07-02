# ⭐ Commander — company intelligence (:7705)

The strategic view above the contacts. Where Sniper/Medic work one person at a time, SpecOps tracks
opportunities, UAV watches job boards, and Engineer charts the funnel — **Commander is external
intelligence on the target companies themselves.** For each company Doug is pursuing it aggregates the
inbound signal and pairs it with curated reference material and an AI briefing.

## What it does

- **Separated feeds** (never one noisy super-feed) per company. Kinds: **news · blog · event ·
  financial · research · general**, with per-company column labels (e.g. OpenAI's news = "Company",
  NVIDIA's general = "AI Podcast"). Each feed is topped with a 1–2 sentence **"Today's summary"**
  line written by the local qwen3 model. One RSS url can split into several kind-buckets by
  `<category>` with priority (OpenAI's single feed → Company / Research & Product / Safety·Eng·
  Security / Other).
- **Curated intel** per company: editable typed sections (mission / values / policy / interview guide /
  financial brief / notes) — you paste gated docs (e.g. OpenAI's interview guide) and seed open ones
  from source. Append-oriented; the `notes` section is yours.
- **SITREP** — an AI narrative that synthesizes the *other apps'* data (SpecOps opportunities, UAV open
  roles, Medic outreach state) into "where you stand + the next best move," at two scopes: a
  whole-campaign SITREP on the dashboard and a per-company one on each company page. It is a briefing,
  not a re-chart — read-only cross-app queries in, prose out.

## Architecture (mirrors UAV)

Node 22 ESM + Express + vanilla-JS SPA on **:7705**, shared `sniper` Postgres DB. Owns four tables
(`feed_items`, `feed_digests`, `company_intel`, `sitreps` — `database/migrations/001_commander.sql`);
reads the other apps' tables read-only for the SITREP. Config-driven, adapter-per-company:

- **`src/sources.js`** — one entry per company: `profile` (public/private — gates the financial feed),
  `homeUrl`, optional `xListUrl` + `links` (header link-outs for login-gated/JS-only pages), an
  `appLimit` (mirrors UAV's application quotas so the SITREP's "apply" action is quota-aware), a
  `feeds` map (kind → adapter config, each with optional `label`/`categories`/selectors), and `intelDocs`.
- **`src/feeds/`** — `rss` (generic; any real RSS/Atom feed) and `html` (generic selector-driven parser
  via cheerio, the equivalent of UAV's custom google.js). A new stubborn board = a new adapter module.
- **`src/tracker.js`** — fetch + upsert (append-only; per-feed failure isolation, like UAV).
- **`src/ai.js`** — qwen3 client reused from `meddic/src/draft.js`: local-with-fallback, Claude
  opt-in only, `/no_think` + `<think>` stripping. **Never calls Claude without `AI_PROVIDER=anthropic`
  AND a key** (suite rule).
- **`src/rollup.js`** — the read-only cross-app SITREP fact queries (contacts by type, going-cold, open
  opportunities by stage, open/applied roles), joined by company name.
- **`src/generate.js`** — regenerates digests + SITREPs (shared by pipeline and the refresh routes).
- **`src/pipeline.js`** — the scheduled entry (systemd timer, 07:15): fetch → digests → SITREPs. No email.
- **`src/routes/commander.js`** — the API; **`public/`** the SPA (dashboard + per-company view).

Run: `npm install && npm run migrate`, then `npm run dev` (:7705) or `npm run pipeline` (scheduled).

## Status — shipped v1 (2026-07-01)

Working end-to-end across **eight companies** (source sweep completed 2026-07-02): every configured
feed fetches clean, titled, and dated; the tracker stores/dedupes; qwen3 writes the per-feed digest
lines; the SITREP is an **orders briefing** built from deterministic funnel action-flags (rollup.js —
Sniper staging queue / Meddic campaign & due-date gaps / quota-aware unapplied UAV roles /
Screen-&-Interview callouts), bulleted in the UI, at whole-campaign + per-company scope. Dashboard
cards show company logos (Sniper's `/media/company-icons/<id>.png`), two dated headlines per feed,
and the action flags as chips. The intel panel has a pinned **Notes** (Link + markdown Note),
editable section names, removable sections, and full-width link rows.

### Source map (v1.1)

Kinds are per-company (a feed config's `label` overrides the column title). Patterns that recur:
**hidden RSS** (WordPress `/feed/`, MediaRoom `/rss.xml`, Discourse `.rss`, blog.google
`<category>/rss/`, podcast feeds via the iTunes lookup API), **selector-driven html cards**, and
**link-outs** for login-gated or JS-rendered pages. Both public companies' IR sites hard-403
non-browsers → no financial feeds; `financial_brief` intel sections instead. One company's site
Cloudflare-challenges ALL server-side fetches (even sitemap.xml, despite a permissive robots.txt) —
its column is a Google-News search feed (minus-terms de-noise an identically-tickered NYSE fund)
plus a site link-out; first-party would need a Wayback-relay adapter or a headless browser (phase 2).

## Deferred (phase 2)

X/Twitter in-app feed (paid API — the one company above would benefit most; v1 links out), SEC EDGAR
filings feeds for the public companies (their IR pages are bot-walled; EDGAR is public JSON), email
digest, per-item AI summaries at scale, intel seeding from `seedable` docs, Commander PNG icons, and
`link-commander` nav entries in the sibling apps.
