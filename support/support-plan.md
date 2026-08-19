# 🛡️ Support — personal network (:7707)

**Mission:** keep the personal network warm. Friends, former colleagues, mentors, referral
sources — the people who keep you supplied. A board of cards you arrange by hand, one card
per person, with the badges that matter visible at a glance.

## The core idea

This is deliberately NOT the targeting pipeline. Sniper→Meddic is for prospects at target
companies; Support is for people Doug already knows. No campaigns, no AI, no automation —
**the card is the person**, and where it sits is a decision Doug made, not one the app made.

Each card carries:

- **note** — the one freeform text field (context, personal email/phone, what's owed)
- **company** — free text; the Sniper-joined company is only a fallback
- **channels** — how you work this person: 📞 call / 💬 text / ✉️ email / LinkedIn, multi-select,
  shown as badges on the card face
- **recc_flag** — 🏅 "I owe this person a LinkedIn recommendation"
- **completed** — a tick that dims the card and stamps `✅ Texted` across its top

## The board (v2, 2026-08-10)

Three columns — **Active / Waiting / Inactive** — with drag between them and drag-to-reorder
within one, the same interaction SpecOps uses. `status` is the column, `sort_order` the manual
position; a drop is one `PUT /api/people/reorder` call that rewrites the whole column.

Nothing is computed and nothing auto-moves. A card sits where it was dropped until it's
dragged again.

### Why v1 was replaced

v1 was a flat list ordered by `updated_at DESC`, so **editing a note jumped that person to the
top** — you could never learn where anyone was. Worse, each person had exactly one `action`
string plus a `done` boolean, so finishing a touch left a greyed-out row with nowhere to go,
and recording the next touch meant overwriting (and losing) the last one. Completion had no
home and priority had no representation.

v2 fixes both by making position manual and completion a visible, non-destructive state.

### Completion and the verb

`completed_via` records **which channel it actually happened on**, and that drives the verb on
the stamp: call→Called, text→Texted, email→Emailed, linkedin→Messaged. One channel on the card
means the verb is unambiguous, so it's inferred; several means the edit view asks, which is what
keeps the stamp honest. Clearing Completed wipes the verb and timestamp so a revived card can't
wear a stale stamp.

## Capture flow

The Sniper Chrome extension has a second button, **→ Support**. It posts the same payload
to Sniper's `POST /capture` with `destination: 'support'`. Sniper's ingest then:

1. upserts `people` as usual (parser + photo reuse) — but new rows get
   `import_status = 'support'`, a value hidden from Sniper's review UI and SpecOps' contact picker;
2. **skips AI enrichment** (no LLM calls for friends);
3. inserts a membership row into `network_people` with `ON CONFLICT (linkedin_slug) DO NOTHING` —
   so a person Doug already added manually keeps their note, badges, and column untouched.

A new card takes the defaults: Active column, `sort_order` NULL — which sorts **first**, so a
fresh capture is the first thing you see rather than the last.

## Sync guarantee

`network_people` rows link to `people` at **read time** (`LEFT JOIN ... ON linkedin_slug`),
so a manual add (with a LinkedIn URL) and a later capture merge automatically — photo and title
appear the moment Sniper knows the person. Support-owned values win the `COALESCE`, so a capture
can never overwrite a name or company typed on a card.

## Schema (owned)

```
network_people
  id             SERIAL PK
  linkedin_slug  TEXT UNIQUE (NULL for manual adds without a URL)
  name           TEXT        (fallback display name; captured name used when linked)
  company        TEXT        (free text; falls back to the joined Sniper company)
  note           TEXT
  channels       TEXT[]      subset of call|text|email|linkedin
  recc_flag      BOOLEAN
  status         TEXT        active|waiting|inactive — which column the card is in
  sort_order     INTEGER     manual position in that column; NULL sorts first
  completed      BOOLEAN
  completed_via  TEXT        call|text|email|linkedin — the verb on the stamp
  completed_at   TIMESTAMPTZ
  created_at / updated_at
```

Reads `people` + `companies` (never writes them). Sniper's ingest is the one outside
writer of `network_people` (the →Support membership insert).

## API

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/people` | the whole board, joined to people/companies, in column order |
| POST | `/api/people` | manual add — name and/or LinkedIn URL; 409 if slug already tracked |
| PUT | `/api/people/reorder` | `{status, ids:[…]}` — one column's new top-to-bottom order |
| PATCH | `/api/people/:id` | name, company, note, channels, recc_flag, status, completed, completed_via |
| DELETE | `/api/people/:id` | removes the Support row only |

Search / recc / channel / hide-completed filtering is **client-side**, so filtering can never make
a column disappear mid-drag. A reorder sent from a filtered board includes the hidden cards of
that column, so they keep their places.

## Shipped

- **v1 (2026-07-21)** — capture via extension →Support, manual adds, note/action/recc list UI,
  filters, cross-app header links, tmux window 8 in `start-ambition.sh`.
- **v2 (2026-08-10)** — the Kanban board above (`002_kanban.sql`). The v1 `action` /
  `action_channel` / `action_done` columns are gone; each row's action text was folded into its
  note (`Action: …`) and its channel became a badge, so nothing was lost.

Known/accepted: Engineer's "Captured" funnel metric counts all `people` rows, so
support-only captures nudge it slightly.
