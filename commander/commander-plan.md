# ⭐ Commander — company rollup (planned)

The strategic view above the contacts. Sniper and Medic both operate one person at a time; the Commander
zooms out to the **target companies**:

- Which companies am I actively working?
- How deep am I into each — how many contacts, of which types (recruiter / peer / hiring manager)?
- What's the outreach state per company — touched recently, going cold, awaiting reply?
- Where should I push next?

## Status

This directory is the reserved home for it. The data it needs already lives in the shared
`sniper` Postgres database (the `companies` table plus Medic's tracker columns on `people`), so the
Commander is primarily a read/aggregate layer — likely the same Express + vanilla-JS SPA pattern as
Sniper and Medic, on its own port.