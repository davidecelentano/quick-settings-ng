#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

forbidden=(
    'global\.stage\.grab'
    'event\.get_device'
    'vfunc_button_(press|release)_event'
    '\._grid\b'
    '\._boxPointer\b'
    '\._backgroundApps\b'
    '\._rightBox\b'
    'GLib\.timeout_add_once'
)

failed=0
for pattern in "${forbidden[@]}"; do
    if grep -R -n -E \
        --include='*.ts' \
        --exclude-dir='dist' \
        --exclude-dir='node_modules' \
        "$pattern" src; then
        printf 'Forbidden source pattern: %s\n' "$pattern" >&2
        failed=1
    fi
done

if grep -R -n -F \
    --include='*.ts' \
    --exclude='gnome51-volume.ts' \
    '_volumeOutput' src; then
    printf 'Private _volumeOutput hook escaped src/compat/gnome51-volume.ts\n' >&2
    failed=1
fi

if ((failed)); then
    exit 1
fi

printf 'QSNG source audit passed.\n'
