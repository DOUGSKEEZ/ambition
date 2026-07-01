# ⭐ Commander — company intelligence (:7705)

The strategic view above the contacts. Where Sniper/Medic work one person at a time, SpecOps tracks
opportunities, UAV watches job boards, and Engineer charts the funnel — **Commander is external
intelligence on the target companies themselves.** For each company Doug is pursuing it aggregates the
inbound signal and pairs it with curated reference material and an AI briefing.

## What it does

- **Separated feeds** (never one noisy super-feed) per company: **News · Blog · Events · Financials**.
  Each feed is topped with a 1–2 sentence **"Today's summary"** line written by the local qwen3 model.
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
  `homeUrl`, optional `xListUrl` (X link-out), a `feeds` map (kind → adapter config), and `intelDocs`.
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

Working end-to-end: RSS feeds (OpenAI news, NVIDIA blog, Google blog/news) fetch clean; the tracker
stores/dedupes; qwen3 produces clean digest lines and an accurate SITREP (verified it cites real
contact/opportunity/role counts from the other apps); the dashboard + company view + intel editor +
refresh + X link-out all render.

### Per-company selector tuning (the "one company at a time" work)

The `html` adapter is generic; each company's selectors are tuned as it's brought online. Current state:

- **OpenAI** — ✅ RSS, clean.
- **NVIDIA** — blog ✅ RSS. `news` (nvidianews) selector + `financial` (IR page 403s bots) need work;
  both isolate safely. Financials are best seeded via the `financial_brief` intel section for now.
- **Google** — blog ✅ RSS, news ✅ (Google-News RSS, noisy). `financial` (Alphabet IR) selector thin.
- **Anthropic** — news/blog ✅ (heading-based titles clean); `events` selector grabs "Learn more" — needs
  a better item selector (the events page is partly JS-rendered).
- **Cursor** — returns items but titles mash date/category (cards have no heading) — needs a `title`
  selector.
- **Arize** — wildcard; blog/news selectors still grab hero/nav links — needs tightening. Do last.

Next tuning pass: add explicit `title`/`item` selectors per stubborn company in `src/sources.js` (no
core-code change), and seed each company's intel sections.

## Deferred (phase 2)

X/Twitter in-app feed (paid API — v1 links out to a curated X List), email digest, a richer financial
adapter (parse actual figures, not just report links), per-item AI summaries at scale, Commander PNG
icons, and `link-commander` nav entries in the sibling apps.
