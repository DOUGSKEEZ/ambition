# Commander pipeline — scheduled run (user systemd timer)

The pipeline (`npm run pipeline`) fetches every configured company feed, upserts new items, then
regenerates the per-feed AI digest lines and the SITREPs. UI-only — no email; the UI reads the
freshly-stored rows. Run it daily at ~7:15am via a **user** systemd timer (`OnCalendar` uses the
host's local timezone — verify with `timedatectl`).

## Install

```sh
mkdir -p ~/.config/systemd/user
ln -sf /home/samwise/ambition/commander/systemd/commander-pipeline.service ~/.config/systemd/user/commander-pipeline.service
ln -sf /home/samwise/ambition/commander/systemd/commander-pipeline.timer   ~/.config/systemd/user/commander-pipeline.timer
systemctl --user daemon-reload
systemctl --user enable --now commander-pipeline.timer
# Make the timer fire even when you're not logged in:
loginctl enable-linger samwise
```

## Verify / operate

```sh
systemctl --user list-timers | grep commander      # next scheduled run
systemctl --user start commander-pipeline.service  # run once now
journalctl --user -u commander-pipeline.service -n 50 --no-pager
```

## Notes
- `ExecStart` uses the absolute nvm node path. If `which node` changes (nvm upgrade), update
  `commander-pipeline.service` to match.
- The pipeline calls the LOCAL qwen3 model for digests/SITREPs (see `.env`). If the model host is
  unreachable, the fetch/store still runs; only the AI lines are skipped for that run.
