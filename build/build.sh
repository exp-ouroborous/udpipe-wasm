#!/usr/bin/env bash
# Reproducible udpipe-wasm build.
#   1. (host) clone pinned UDPipe, merge src_lib_only into one udpipe.cpp
#   2. (host emscripten) compile udpipe.cpp + binding.cpp -> wasm + glue
#
# Toolchain: Emscripten (validated with 6.0.1). For a fully hermetic CI build,
# run step 2 inside `emscripten/emsdk` Docker instead of the host emcc — the
# compile command is identical; see build/README.md.
set -euo pipefail

UDPIPE_REF="v1.3.1"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$ROOT/build/.work"
OUT="$ROOT/src"   # glue + wasm land beside the TS sources (gitignored); do NOT rm this dir

command -v emcc >/dev/null 2>&1 || { echo "error: emcc not on PATH (install emscripten)"; exit 1; }

rm -rf "$WORK"
rm -f "$OUT/udpipe.glue.cjs" "$OUT/udpipe.wasm"   # remove only our artifacts, never the src tree
mkdir -p "$WORK"

# --- 1. host: fetch pinned source and merge into a single translation unit ---
git clone --depth 1 --branch "$UDPIPE_REF" https://github.com/ufal/udpipe.git "$WORK/udpipe"
( cd "$WORK/udpipe/src_lib_only" && make udpipe.cpp )
cp "$WORK/udpipe/src_lib_only/udpipe.cpp" "$WORK/"
cp "$WORK/udpipe/src_lib_only/udpipe.h"   "$WORK/"
cp "$ROOT/build/binding.cpp"              "$WORK/"

# --- 2. emscripten compile (-Oz: code size; model is the real payload) ---
# Output basename "udpipe" => udpipe.js + udpipe.wasm. The glue references
# udpipe.wasm internally; we then rename the JS to udpipe.glue.cjs.
( cd "$WORK" && em++ -Oz -std=c++17 udpipe.cpp binding.cpp -I. --bind \
    -s MODULARIZE=1 -s EXPORT_NAME=createUDPipe \
    -s ENVIRONMENT=web,worker,node \
    -s ALLOW_MEMORY_GROWTH=1 -s FORCE_FILESYSTEM=1 -s INVOKE_RUN=0 \
    -s 'EXPORTED_RUNTIME_METHODS=["FS"]' \
    -o udpipe.js )
mv "$WORK/udpipe.js" "$WORK/udpipe.glue.cjs"

cp "$WORK/udpipe.glue.cjs" "$OUT/"
cp "$WORK/udpipe.wasm"    "$OUT/"
echo "built: $OUT/udpipe.glue.cjs $OUT/udpipe.wasm"
ls -lh "$OUT/udpipe.glue.cjs" "$OUT/udpipe.wasm"
