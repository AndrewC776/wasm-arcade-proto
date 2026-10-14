#!/usr/bin/env bash
# Publish dist/ to the gh-pages branch of origin; GitHub Pages serves it as-is.
# Run ./build.sh first. The gh-pages branch is a single deploy commit, replaced each time.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[[ -f "$ROOT/dist/index.html" && -f "$ROOT/dist/catalog.json" ]] || { echo "dist/ is missing, run ./build.sh first" >&2; exit 1; }

REMOTE="$(git -C "$ROOT" remote get-url origin)"
SRC_SHA="$(git -C "$ROOT" rev-parse --short HEAD)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cp -R "$ROOT/dist/." "$TMP/"
touch "$TMP/.nojekyll"
git -C "$TMP" init -q -b gh-pages
git -C "$TMP" add -A
git -C "$TMP" commit -q -m "deploy: dist built from ${SRC_SHA}"
git -C "$TMP" push -f "$REMOTE" gh-pages
