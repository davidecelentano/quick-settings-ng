#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UUID="quick-settings-ng@davidecelentano.github.com"
ZIP="$ROOT/build/$UUID.shell-extension.zip"

cd "$ROOT"

npm run pack
gnome-extensions install --force "$ZIP"

dbus-run-session -- bash -c '
set -euo pipefail

UUID="quick-settings-ng@davidecelentano.github.com"
SCHEMA="org.gnome.shell.extensions.quick-settings-ng"
EXTDIR="$HOME/.local/share/gnome-shell/extensions/$UUID"
SCHEMA_DIR="$EXTDIR/schemas"
LOG="/tmp/qsng-full-ui.log"

TEST_KEYS=(
    privacy-enabled
    media-enabled
    volume-mixer-enabled
    layout-enabled
    menu-effects-enabled
    media-artwork-enabled
    media-progress-enabled
    media-player-navigation-enabled
    privacy-grouped
    privacy-click-to-toggle
    layout-compact
)

declare -A SAVED_SETTINGS
for key in "${TEST_KEYS[@]}"; do
    SAVED_SETTINGS["$key"]="$(
        GSETTINGS_SCHEMA_DIR="$SCHEMA_DIR" \
            gsettings get "$SCHEMA" "$key"
    )"
done

rm -f "$LOG"

gnome-shell --devkit --wayland >"$LOG" 2>&1 &
SHELL_PID=$!
MOCK1_PID=""
MOCK2_PID=""

restore_settings() {
    for key in "${TEST_KEYS[@]}"; do
        GSETTINGS_SCHEMA_DIR="$SCHEMA_DIR" \
            gsettings set "$SCHEMA" "$key" "${SAVED_SETTINGS[$key]}" \
            2>/dev/null || true
    done
}

cleanup() {
    restore_settings

    for pid in "$MOCK1_PID" "$MOCK2_PID"; do
        if [[ -n "$pid" ]]; then
            kill "$pid" 2>/dev/null || true
            wait "$pid" 2>/dev/null || true
        fi
    done

    kill "$SHELL_PID" 2>/dev/null || true
    wait "$SHELL_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

for _ in $(seq 1 60); do
    if gnome-extensions info "$UUID" >/dev/null 2>&1; then
        break
    fi
    sleep 0.5
done

for key in \
    privacy-enabled \
    media-enabled \
    volume-mixer-enabled \
    layout-enabled \
    menu-effects-enabled \
    media-artwork-enabled \
    media-progress-enabled \
    media-player-navigation-enabled \
    privacy-grouped \
    layout-compact; do
    GSETTINGS_SCHEMA_DIR="$SCHEMA_DIR" \
        gsettings set "$SCHEMA" "$key" true
done

GSETTINGS_SCHEMA_DIR="$SCHEMA_DIR" \
    gsettings set "$SCHEMA" privacy-click-to-toggle false

gnome-extensions enable "$UUID"

gjs -m tools/mpris-mock.mjs >>"$LOG" 2>&1 &
MOCK1_PID=$!
QSNG_MOCK_SUFFIX=Two gjs -m tools/mpris-mock.mjs >>"$LOG" 2>&1 &
MOCK2_PID=$!

sleep 2

printf "\n=== QUICK SETTINGS NG ===\n"
gnome-extensions info "$UUID" | grep -E "Name:|State:|Path:" || true

printf "\nFull QSNG milestone test is running in the nested GNOME Shell.\n"
printf "Expected QSNG grid order: Privacy, Media. Application Volume lives inside the stock GNOME volume menu when an app is producing audio.\n"
printf "Media: test both mock players, artwork, progress/seek, exclusive playback and all buttons.\n"
printf "Privacy: test grouped menu; the main tile must not change checked state when click-to-toggle is disabled.\n"
printf "Volume: start an audio app in the nested session, open the arrow on the stock GNOME volume row, and verify the Application Volume section/sliders/mute buttons.\n"
printf "Layout/effects: reopen Quick Settings repeatedly and verify compact spacing/open animation.\n"
printf "Close the nested Shell window when finished.\n\n"

wait "$SHELL_PID" || true
trap - EXIT INT TERM
cleanup

printf "\n=== QSNG LOG ===\n"
grep -E "QSNG|JS ERROR|CRITICAL|extension startup failed" "$LOG" || true
'
