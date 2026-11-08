#!/bin/bash
# Measures the locker's CPU use: 10 seconds idle, then 10 seconds while you play.
~/greeting-lock/lock.sh --test >/dev/null 2>&1 &
sleep 3
PID=$(pgrep -f "greeting-lock/lock.py" | head -1)
if [ -z "$PID" ]; then echo "locker did not start"; exit 1; fi
HZ=$(getconf CLK_TCK)
ticks() { awk '{print $14+$15}' /proc/$PID/stat; }
measure() { local a b; a=$(ticks); sleep 10; b=$(ticks); echo $(( (b-a)*100/(10*HZ) )); }
echo "Leave the window alone for 10 seconds..."
echo "idle: $(measure)% of one core"
echo "Now click the window and press Ctrl+G, then play for 10 seconds..."
echo "playing: $(measure)% of one core"
pkill -f greeting-lock/lock.sh
kill "$PID" 2>/dev/null
