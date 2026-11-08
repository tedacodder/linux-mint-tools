#!/bin/bash
# Runs the locker and restarts it if it crashes or is killed. It stops only after a correct password.
# A second copy exits immediately, so a keyboard shortcut and xss-lock can both call this safely.
cd "$HOME" || exit 1
PY=/usr/bin/python3
DIR="$(cd "$(dirname "$0")" && pwd)"

if ! err=$("$PY" -c "import gi, PAM; gi.require_version('Gtk', '3.0'); from gi.repository import Gtk" 2>&1); then
    echo "Dependency check failed:" >&2
    echo "$err" >&2
    exit 1
fi

exec 9>"/tmp/greeting-lock.$(id -u).lock"
flock -n 9 || exit 0
until "$PY" "$DIR/lock.py" "$@"; do
    sleep 0.5
done
