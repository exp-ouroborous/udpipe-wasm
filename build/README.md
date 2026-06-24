# Build

`bash build/build.sh` produces `src/udpipe.glue.cjs` + `src/udpipe.wasm`
(gitignored), which the `build:ts` npm script then copies into `dist/`.

- **Host step:** clones UDPipe `v1.3.1`, runs `make udpipe.cpp` in `src_lib_only`
  to merge all sources into one translation unit (needs any C++ compiler).
- **Compile step:** Emscripten compiles the merged source + `binding.cpp` with
  `-Oz -std=c++17 --bind` into wasm + glue. Validated with Emscripten **6.0.1**.

The glue is emitted as **CommonJS** (`.cjs`) so it loads correctly regardless of
the consuming package's `type` field; ESM consumers get the factory via default
import. The model is **not** built or bundled here — it is fetched at runtime by
the consumer (see top-level README, bring-your-own-model).

## Reproducible / CI builds

For a hermetic build, run the compile step inside the pinned Emscripten image
instead of the host `emcc` — the command is identical:

```bash
docker run --rm -v "$PWD/build/.work":/src -w /src emscripten/emsdk:<pin> \
  em++ -Oz -std=c++17 udpipe.cpp binding.cpp -I. --bind \
    -s MODULARIZE=1 -s EXPORT_NAME=createUDPipe -s ENVIRONMENT=web,worker,node \
    -s ALLOW_MEMORY_GROWTH=1 -s FORCE_FILESYSTEM=1 -s INVOKE_RUN=0 \
    -s 'EXPORTED_RUNTIME_METHODS=["FS"]' -o udpipe.js
```
