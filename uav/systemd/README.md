# UAV pipeline — scheduled run (user systemd timer)

The pipeline (`npm run pipeline`) fetches every configured board, diffs against the DB, and emails
a digest. Run it daily at ~7am via a **user** systemd timer (`OnCalendar` uses the host's local
timezone — verify with `timedatectl`).

## Install

```sh
mkdir -p ~/.config/systemd/user
ln -sf /home/samwise/ambition/uav/systemd/uav-pipeline.service ~/.config/systemd/user/uav-pipeline.service
ln -sf /home/samwise/ambition/uav/systemd/uav-pipeline.timer   ~/.config/systemd/user/uav-pipeline.timer
systemctl --user daemon-reload
systemctl --user enable --now uav-pipeline.timer
# Make the timer fire even when you're not logged in:
loginctl enable-linger samwise
```

## Verify / operate

```sh
systemctl --user list-timers | grep uav      # next scheduled run
systemctl --user start uav-pipeline.service  # run once now
journalctl --user -u uav-pipeline.service -n 50 --no-pager
```

## Notes
- `ExecStart` uses the absolute nvm node path. If `which node` changes (nvm upgrade), update
  `uav-pipeline.service` to match.
- Email needs `SMTP_USER`/`SMTP_PASS` set in `uav/.env`. Without them the run still records the
  diff in the DB; it just skips the email.
