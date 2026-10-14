#!/usr/bin/env bash
# Compile upstream doomgeneric (unmodified) to dist/engine/doom.{js,wasm}.
# The engine ships without baked-in data: packages are mounted at runtime by web/loader.js.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/third_party/doomgeneric/doomgeneric"
OBJ="$ROOT/build/engine-obj"
OUT="$ROOT/dist/engine"

# shellcheck disable=SC1091
source "$ROOT/toolchain/emsdk/emsdk_env.sh" >/dev/null 2>&1
mkdir -p "$OBJ" "$OUT"

# Reuse the upstream source list so the build tracks upstream exactly.
SOURCES=$(sed -n 's/^SRC_DOOM = //p' "$SRC/Makefile.emscripten" | tr ' ' '\n' | sed -n 's/\.o$/.c/p')

CFLAGS=(-O2 -DFEATURE_SOUND -sUSE_SDL=2 -sUSE_SDL_MIXER=2 '-sSDL2_MIXER_FORMATS=["mid"]' -w)

# Warm the SDL ports once so parallel compiles don't race on the port cache.
echo 'int main(void){return 0;}' > "$OBJ/ports-warmup.c"
emcc "${CFLAGS[@]}" "$OBJ/ports-warmup.c" -o "$OBJ/ports-warmup.js"

export SRC OBJ
export CFLAGS_STR="${CFLAGS[*]}"
echo "$SOURCES" | xargs -P 8 -I{} bash -c \
  'f="{}"; eval "emcc $CFLAGS_STR -c \"$SRC/$f\" -o \"$OBJ/${f%.c}.o\""'

OBJECTS=()
for f in $SOURCES; do OBJECTS+=("$OBJ/${f%.c}.o"); done

emcc "${CFLAGS[@]}" "${OBJECTS[@]}" -o "$OUT/doom.js" \
  -sMODULARIZE=1 -sEXPORT_NAME=createDoomEngine \
  -sINVOKE_RUN=0 -sEXIT_RUNTIME=0 \
  -sEXPORTED_RUNTIME_METHODS=FS,callMain \
  -sFORCE_FILESYSTEM=1 -sALLOW_MEMORY_GROWTH=1 \
  -sENVIRONMENT=web -lm

ls -l "$OUT"
