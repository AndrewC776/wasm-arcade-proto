#!/usr/bin/env bash
# Full build: extract WADs, compile engine, copy web shell, pack chunked data packages.
# Output goes to dist/. Requires toolchain/emsdk (see README).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
DL="$ROOT/downloads/freedoom"
WADS="$ROOT/build/wads"
DIST="$ROOT/dist"

mkdir -p "$WADS" "$DIST/licenses"

# Verify release archives against the official checksum file before using them.
(cd "$DL" && grep -E '^SHA256 \(' freedoom-0.13.0-CHECKSUM \
  | sed -E 's/^SHA256 \((.*)\) = ([0-9a-f]+)$/\2  \1/' | shasum -a 256 -c -)

unzip -o -j -q "$DL/freedoom-0.13.0.zip" 'freedoom-0.13.0/freedoom1.wad' 'freedoom-0.13.0/freedoom2.wad' -d "$WADS"
unzip -o -j -q "$DL/freedm-0.13.0.zip" 'freedm-0.13.0/freedm.wad' -d "$WADS"
unzip -o -j -q -p "$DL/freedoom-0.13.0.zip" 'freedoom-0.13.0/COPYING.txt' > "$DIST/licenses/freedoom-COPYING.txt"
cp "$ROOT/third_party/doomgeneric/LICENSE" "$DIST/licenses/doomgeneric-LICENSE.txt"

"$ROOT/engine/build-engine.sh"

cp "$ROOT"/web/*.html "$ROOT"/web/*.js "$ROOT"/web/*.css "$DIST/"

node "$ROOT/tools/pack.mjs" "$ROOT/packages.config.json" "$DIST"
