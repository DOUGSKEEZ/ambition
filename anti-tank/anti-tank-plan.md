# 🚀 Anti-Tank — interview prep (:7706)

So Doug doesn't TANK the interview. Where the rest of the squad wins the *meeting* (Sniper acquires,
Medic nurtures, UAV watches the boards, SpecOps tracks the live opportunity, Commander briefs on the
company), Anti-Tank owns the last mile: **being ready in the room**. It anchors on a SpecOps
opportunity and turns everything the suite already knows into a briefing, a checklist, and a drilled
question bank. This is the "Support half" SpecOps's plan originally penciled in — it lives here now.

## What it does

Three tabs per opportunity (home = the opportunity list, filtered to prep-live stages `hm_reply` +
`screen_interview` by default, with per-card prep meters):

- **Briefing** — the dossier, assembled live and cross-app: Commander's `company_intel` sections
  (mission / values / interview guide), the UAV posting SpecOps pinned (`job_posting_id`), the
  target people from `opportunity_contacts` joined to Sniper's profiles (`ai_summary` / `ai_ins` /
  `my_notes`, primary-HM badge), plus Anti-Tank's OWN sections — **My Angle** and any other
  section-keyed briefs (`questions_for_them`, `logistics`, …) — and a phase-grouped **checklist**
  (Before / Day of / After) instantiated from a reusable template (the Meddic template→instance
  copy; the migration seeds a 12-item "Screen prep" default). Every empty cross-app slice renders a
  link-out ("No Commander intel for X ↗"), never a blank block.
- **Drill** — the question bank as one card at a time, **weakest-first** (shaky > never-drilled >
  nailed; shuffle + category filters). Reveal my prepared answer + linked stories → self-grade
  **😀 Nailed / 😬 Shaky** (stats persist per question) → optional **Pushback**: local qwen3 plays
  the skeptical interviewer with ONE tough follow-up, grounded in what I actually said (an optional
  spoken-notes box). A "Manage bank" sub-view does question CRUD + story linking.
- **Stories** — the GLOBAL STAR library (Situation/Task/Action/Result, all optional, plus freeform
  + tags). Written once, linked M:N to questions across every interview; drill cards expand them
  inline.

## The AI split (and why the app is keyless)

- **Generation = Claude Code in the terminal, not an API.** There is deliberately NO
  `ANTHROPIC_API_KEY` and no Claude code path in this app. Question banks, checklists, angle and
  brief drafts arrive as **prep packs** via a validated, deduping, transactional import endpoint.
  The round-trip any future session runs:

  ```bash
  curl :7706/api/pack-schema                        # the contract, self-documenting
  curl :7706/api/opportunities/<id>/pack-context    # intel + posting + people + existing titles
  # …generate pack.json…
  curl -X POST :7706/api/opportunities/<id>/pack -H 'Content-Type: application/json' -d @pack.json
  ```

  Packs are validated exhaustively (a 400 lists every problem — the consumer self-corrects),
  deduped (questions by text, checklist by label, stories upsert by title), imported in one
  transaction, and logged append-only to `prep_packs` (exact payload + counts). `mode:'replace'`
  archives the previous claude-sourced questions — drill history preserved, never deleted.
- **Runtime = local qwen3 only** (`LOCAL_LLM_URL` → `LOCAL_LLM_FALLBACK_URL`), used solely for
  drill banter; a dead endpoint degrades to a toast, never an error.

## Architecture (mirrors Commander)

- `src/server.js` — express bootstrap, `/api` router, Sniper `/media` mount (logos + contact
  photos), static SPA, JSON error handler. Port **7706**.
- `src/db.js` — pg pool + `withTransaction` against the shared `sniper` DB.
- `src/briefing.js` — the cross-app read module (rollup.js analog): `listOpportunities`,
  `getBriefing`, `getPackContext`. Every cross-app slice is independent + best-effort (try/catch →
  degraded slice + `warnings[]`); joins by FK where SpecOps has one, else by company name.
- `src/pack.js` — pack schema/validation/import (`PACK_SCHEMA` served at `/api/pack-schema`).
- `src/ai.js` — local-only qwen3 banter helper (`generateBanter` → text or null, never throws).
- `src/routes/antitank.js` — the HTTP surface: opportunities/briefing, briefs upsert, checklist
  templates + instantiate + item CRUD, questions + `/grade` + `/banter` + story links, stories
  CRUD (archive on delete), pack context/import/schema.
- `public/` — vanilla-JS hash-routed SPA (`#/`, `#/opp/<id>/briefing|drill`, `#/stories`), shared
  Ambition chrome, injection-safe mini-markdown renderer.

Tables OWNED: `prep_questions`, `checklist_templates`, `checklist_template_items`,
`opportunity_checklist_items`, `stories`, `question_stories`, `opportunity_briefs`, `prep_packs`.
Tables READ (never written): `opportunities`, `opportunity_contacts`, `companies`, `people`,
`company_intel`, `job_postings`.

Run: `npm install` → `.env` from `.env.example` → `npm run migrate` → `npm run dev` (or via
`../start-ambition.sh`, window 7).

## Status

— shipped v1 (2026-07-08). Server + API + SPA verified end-to-end (curl + headless Selenium);
first real prep pack lands as a separate Claude Code content pass.

## Notes / open questions

- **CASCADE on opportunity delete**: all prep rows ride `opportunities(id) ON DELETE CASCADE` —
  deleting an opportunity in SpecOps destroys its prep. Accepted: SpecOps closes (stage `closed`)
  rather than deletes.
- **Sibling headers don't link back to :7706 yet** — adding a 🚀 link-out to the other six apps'
  chrome is a small follow-up touching all of them.
- Checklist instantiation is a manual button (no auto-instantiate on first view) — revisit if it
  feels like friction.
- Multi-round prep (per-round checklists/questions + post-round debrief feeding the next round)
  is the natural v2 once real interviews shape the need.
