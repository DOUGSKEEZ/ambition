#!/bin/bash
# Start the ambition dev servers (sniper :7700 + meddic :7701 + engineer :7702 + specops :7703 + uav :7704 + commander :7705 + anti-tank :7706 + support :7707) in a tmux session.
# One session, one window per app. Re-runnable: no-ops if the session already exists.
SESSION="ambition-dev"
ROOT="/home/samwise/ambition"

if tmux has-session -t "$SESSION" 2>/dev/null; then
    echo "Session '$SESSION' already exists. Attach with: tmux attach -t $SESSION"
    exit 0
fi

# Window 1: sniper
tmux new-session -d -s "$SESSION" -n sniper -c "$ROOT/sniper"
tmux send-keys -t "$SESSION:sniper" "npm run dev" Enter

# Window 2: meddic
tmux new-window -t "$SESSION" -n meddic -c "$ROOT/meddic"
tmux send-keys -t "$SESSION:meddic" "npm run dev" Enter

# Window 3: engineer (analytics)
tmux new-window -t "$SESSION" -n engineer -c "$ROOT/engineer"
tmux send-keys -t "$SESSION:engineer" "npm run dev" Enter

# Window 4: specops (opportunities)
tmux new-window -t "$SESSION" -n specops -c "$ROOT/specops"
tmux send-keys -t "$SESSION:specops" "npm run dev" Enter

# Window 5: uav (job-posting radar)
tmux new-window -t "$SESSION" -n uav -c "$ROOT/uav"
tmux send-keys -t "$SESSION:uav" "npm run dev" Enter

# Window 6: commander (company intelligence)
tmux new-window -t "$SESSION" -n commander -c "$ROOT/commander"
tmux send-keys -t "$SESSION:commander" "npm run dev" Enter

# Window 7: anti-tank (interview prep)
tmux new-window -t "$SESSION" -n anti-tank -c "$ROOT/anti-tank"
tmux send-keys -t "$SESSION:anti-tank" "npm run dev" Enter

# Window 8: support (personal network)
tmux new-window -t "$SESSION" -n support -c "$ROOT/support"
tmux send-keys -t "$SESSION:support" "npm run dev" Enter

echo "Session '$SESSION' created:"
echo "  sniper    -> http://0.0.0.0:7700"
echo "  meddic    -> http://0.0.0.0:7701"
echo "  engineer  -> http://0.0.0.0:7702"
echo "  specops   -> http://0.0.0.0:7703"
echo "  uav       -> http://0.0.0.0:7704"
echo "  commander -> http://0.0.0.0:7705"
echo "  anti-tank -> http://0.0.0.0:7706"
echo "  support   -> http://0.0.0.0:7707"
echo "Attach with: tmux attach -t $SESSION   (switch windows: Ctrl-b n)"
echo "Stop with:   ./kill-ambition.sh"
