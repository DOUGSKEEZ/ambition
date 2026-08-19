---
name: verify
description: Verify ambition app changes end-to-end — restart via repo scripts, curl the JSON APIs, and drive the vanilla-JS SPAs headlessly with snap Firefox + geckodriver + Selenium.
---

# Verifying ambition changes

All six apps are Express + vanilla-JS hash-routed SPAs: sniper :7700, meddic :7701,
engineer :7702, specops :7703, uav :7704, commander :7705.

## Restart (always via the repo scripts, never ad-hoc pkill)

```bash
cd /home/samwise/ambition && ./kill-ambition.sh && ./start-ambition.sh
```

The dev `--watch` can go stale — restart after editing server code before concluding a
change "doesn't work".

## API surface

Plain JSON, no auth: `curl -s localhost:<port>/api/... | jq`.

## Browser surface (headless)

No Chromium/Playwright on this box. What works: **snap Firefox + snap geckodriver +
Selenium via uv**.

Gotchas that cost time:
- `binary_location` must be the real snap binary `/snap/firefox/current/usr/lib/firefox/firefox`
  — `/usr/bin/firefox` is a wrapper and geckodriver rejects it ("binary is not a Firefox executable").
- Snap confinement can't read `/tmp`: run with `TMPDIR=$HOME/tmp/<dir>` and save
  screenshots under `$HOME`, not `/tmp`.
- Fresh profile renders the LIGHT theme; force dark with
  `localStorage.setItem('theme','dark')` + reload + `document.documentElement.setAttribute('data-theme','dark')`.

Working skeleton (run: `TMPDIR=$HOME/tmp/x uv run --quiet --with selenium script.py`):

```python
from selenium import webdriver
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.firefox.service import Service
opts = Options(); opts.add_argument("--headless"); opts.add_argument("--width=1500")
opts.binary_location = "/snap/firefox/current/usr/lib/firefox/firefox"
d = webdriver.Firefox(options=opts, service=Service("/snap/bin/geckodriver"))
d.get("http://localhost:7705/")  # then find_elements / click / save_screenshot
```

SPAs render async after fetch — poll for a selector (no jQuery/waits built in), and
`time.sleep(0.3)` after clicks that re-render.
