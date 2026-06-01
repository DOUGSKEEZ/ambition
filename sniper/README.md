# Sniper

Turn a LinkedIn profile Doug is **already viewing in his own browser** into a staged Person record —
deterministic fields parsed from the page plus type-specific AI notes — reviewed and approved in a small
local web UI. Sniper never fetches LinkedIn; capture happens client-side in Doug's authenticated tab.

## Parts

- **`extension/`** — MV3 Chrome/Firefox capture extension (dumb capturer; no parsing logic).
- **`src/`** — Node 22 ESM service: `/capture`, deterministic parse, AI synthesis, review API, inbox watcher.
- **`public/`** — vanilla-JS review SPA served by the service.

## Setup

```bash
npm install
createdb sniper                 # one-time
npm run migrate                 # apply database/migrations/*.sql
cp .env.example .env            # adjust if needed (port 7700, DATABASE_URL, LLM_URL)
npm start                       # http://192.168.10.21:7700
```

Review UI: <http://192.168.10.21:7700/>

## Test the parser without infra

```bash
npm run parse-test fixtures/some-profile.html     # raw "Save Page As" HTML
npm run parse-test fixtures/payload.json          # a captured payload
```

## Inbox fallback

Drop a capture-payload JSON into `inbox/` and the watcher ingests it (used when the extension's POST is
blocked, or for manual captures). Processed files move to `inbox/processed/`, failures to `inbox/failed/`.

## Install the extension

1. `chrome://extensions` → enable Developer mode → **Load unpacked** → select `extension/`.
2. Open a LinkedIn profile (`/in/...`), click the Sniper icon, pick company + type, **Capture**.
3. New companies are created only in the review UI, not the extension.

## LLM

Type-specific synthesis posts to `LLM_URL` (30B, `192.168.20.21:8080`) with `LLM_FALLBACK_URL` (4B,
`:8082`). Both are **cross-VLAN** from Samwise — ensure the inter-VLAN firewall permits Samwise → .20.21.
Set `LLM_MODEL` in `.env` (discover via `curl http://192.168.20.21:8080/v1/models`).

## Capture payload contract

```json
{
  "url": "https://www.linkedin.com/in/{slug}/",
  "company_id": 1,
  "type": "recruiter | peer | hiring_manager",
  "priority": 1,
  "captured_at": "ISO-8601",
  "html": "<full outerHTML>",
  "jsonld": ["<raw ld+json strings>"],
  "photo": "data:image/jpeg;base64,..."
}
```
