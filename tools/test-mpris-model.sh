#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="/tmp/qsng-mpris-mock.log"

cd "$ROOT"

npm run build

rm -f "$LOG"

dbus-run-session -- bash -c '
set -euo pipefail

ROOT="$1"
LOG="$2"
SERVICE="org.mpris.MediaPlayer2.QSNGTest"
OBJECT="/org/mpris/MediaPlayer2"

cd "$ROOT"

gjs -m tools/mpris-mock.mjs >"$LOG" 2>&1 &
MOCK_PID=$!
QSNG_MOCK_SUFFIX=Two gjs -m tools/mpris-mock.mjs >>"$LOG" 2>&1 &
MOCK2_PID=$!

cleanup() {
    kill "$MOCK_PID" 2>/dev/null || true
    wait "$MOCK_PID" 2>/dev/null || true
    kill "$MOCK2_PID" 2>/dev/null || true
    wait "$MOCK2_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

for i in $(seq 1 60); do
    if gdbus introspect \
        --session \
        --dest "$SERVICE" \
        --object-path "$OBJECT" \
        >/dev/null 2>&1; then
        break
    fi

    sleep 0.05
done

if ! gdbus introspect \
    --session \
    --dest "$SERVICE" \
    --object-path "$OBJECT" \
    >/dev/null 2>&1; then
    echo "ERROR: mock MPRIS service did not start" >&2
    cat "$LOG" >&2 || true
    exit 1
fi

gjs -m tools/test-mpris-player.mjs
gjs -m tools/test-mpris-store.mjs

echo
echo "=== MOCK LOG ==="
cat "$LOG"
' bash "$ROOT" "$LOG"
