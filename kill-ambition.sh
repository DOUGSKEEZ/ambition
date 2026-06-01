#!/bin/bash
# Stop the ambition dev servers by killing the tmux session (which kills sniper + meddic).
SESSION="ambition-dev"

if tmux has-session -t "$SESSION" 2>/dev/null; then
    tmux kill-session -t "$SESSION"
    echo "Session '$SESSION' killed (sniper + meddic stopped)."
else
    echo "No '$SESSION' session running."
fi
