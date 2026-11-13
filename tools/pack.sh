#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$ROOT/dist"
BUILD="$ROOT/build"
UUID="quick-settings-ng@davidecelentano.github.io"
ZIP="$BUILD/$UUID.shell-extension.zip"

cd "$ROOT"

echo "== Building =="
npm run build

echo
echo "== Validating dist =="

required=(
    "extension.js"
    "metadata.json"
    "LICENSE"
    "prefs.js"
    "stylesheet.css"
    "core/disposable.js"
    "core/feature.js"
    "core/feature-manager.js"
)

for file in "${required[@]}"; do
    if [[ ! -f "$DIST/$file" ]]; then
        echo "ERROR: missing dist/$file" >&2
        exit 1
    fi

    printf '  OK  %s\n' "$file"
done

echo
echo "== Preparing package =="

rm -rf "$BUILD"
mkdir -p "$BUILD"

python3 - "$DIST" "$ZIP" <<'PY'
from pathlib import Path
import sys
import zipfile

dist = Path(sys.argv[1])
output = Path(sys.argv[2])

with zipfile.ZipFile(
    output,
    "w",
    compression=zipfile.ZIP_DEFLATED,
    compresslevel=9,
) as archive:
    for path in sorted(dist.rglob("*")):
        if not path.is_file():
            continue

        relative = path.relative_to(dist)
        archive.write(path, relative)

print(output)
PY

echo
echo "== Testing package =="

unzip -t "$ZIP"

echo
echo "== Package created =="

ls -lh "$ZIP"
