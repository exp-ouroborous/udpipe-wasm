# udpipe-wasm Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a standalone, open-source `udpipe-wasm` repo that runs a full UDPipe dependency parse in the browser and exposes `loadParser({ modelUrl })` → `parse(text) → DependencyTree`.

**Architecture:** A host step merges UDPipe's `src_lib_only` C++ into one translation unit; a pinned Emscripten Docker step compiles that plus a tiny Embind binding into `udpipe.wasm` + glue. A pure-TypeScript wrapper fetches a caller-supplied model into the wasm filesystem, runs the tokenize→tag→parse pipeline, and parses the CoNLL-U output into a typed dependency tree. The model is **never bundled** (bring-your-own-model).

**Tech Stack:** UDPipe (C++, MPL-2.0), Emscripten 6.0.1 (Embind), TypeScript, Vitest, Docker, npm.

## Global Constraints

- **English-only** for v1 (interface allows other models via `modelUrl`).
- **Model is NOT bundled.** `modelUrl` is a required `loadParser` option; the package ships only wasm + glue + JS.
- **License: MPL-2.0** for the whole repo (matches UDPipe upstream; the compiled wasm is MPL-derived).
- **Pinned build:** Emscripten `6.0.1`, `-std=c++17` (Embind needs ≥C++14; UDPipe's C++11 source compiles under 17), UDPipe ref `v1.3.1`, model `english-ewt-ud-2.5-191206.udpipe`.
- **No Web Worker.** Parsing runs on the main thread (spike: 3–4 ms warm). The one-time model load (~0.7 s) is the caller's loading-state concern.
- **`parse()` never throws on malformed/empty input** — it returns an empty-token tree. **`loadParser()` rejects cleanly** on fetch / instantiate / model-load failure (the parser is optional at runtime for consumers).
- **The wasm compile step is reproducible via Docker.** The source-merge step runs on the host (needs only a normal C++ compiler).
- New repo lives at `/Users/binitmohanty/Source/udpipe-wasm` (sibling of this project). Its own git history; commit frequently.

---

### Task 1: Repo scaffold

**Files:**
- Create: `/Users/binitmohanty/Source/udpipe-wasm/package.json`
- Create: `/Users/binitmohanty/Source/udpipe-wasm/tsconfig.json`
- Create: `/Users/binitmohanty/Source/udpipe-wasm/vitest.config.ts`
- Create: `/Users/binitmohanty/Source/udpipe-wasm/.gitignore`
- Create: `/Users/binitmohanty/Source/udpipe-wasm/LICENSE`

**Interfaces:**
- Consumes: nothing.
- Produces: a buildable/testable empty TS project. `npm test` runs Vitest; `npm run build` runs `tsc` + asset copy (asset copy is a no-op until Task 3).

- [ ] **Step 1: Create the repo and init git**

```bash
mkdir -p /Users/binitmohanty/Source/udpipe-wasm
cd /Users/binitmohanty/Source/udpipe-wasm
git init
mkdir -p src test/fixtures build dist
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "udpipe-wasm",
  "version": "0.1.0",
  "description": "UDPipe dependency parser compiled to WebAssembly. Browser-local tokenize/tag/parse to a Universal Dependencies tree.",
  "license": "MPL-2.0",
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./udpipe.wasm": "./dist/udpipe.wasm",
    "./udpipe.glue.js": "./dist/udpipe.glue.js"
  },
  "files": ["dist"],
  "scripts": {
    "build:wasm": "bash build/build.sh",
    "build:ts": "tsc && cp src/udpipe.glue.js dist/udpipe.glue.js && cp src/udpipe.wasm dist/udpipe.wasm",
    "build": "npm run build:wasm && npm run build:ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "fetch:model": "bash test/fetch-model.sh"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/**/*.test.ts"] },
});
```

- [ ] **Step 5: Write `.gitignore`**

```gitignore
node_modules/
dist/
build/.work/
src/udpipe.glue.js
src/udpipe.wasm
test/fixtures/*.udpipe
```

- [ ] **Step 6: Add the MPL-2.0 `LICENSE`**

```bash
cd /Users/binitmohanty/Source/udpipe-wasm
curl -sL https://www.mozilla.org/media/MPL/2.0/index.txt -o LICENSE
test -s LICENSE && head -1 LICENSE
```
Expected: prints `Mozilla Public License Version 2.0`.

- [ ] **Step 7: Install dev deps and verify the empty project**

Run:
```bash
cd /Users/binitmohanty/Source/udpipe-wasm
npm install
npx vitest run
```
Expected: Vitest runs and reports "No test files found" (exit 0 is fine; there are no tests yet).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold udpipe-wasm repo (package, tsconfig, vitest, MPL-2.0)"
```

---

### Task 2: CoNLL-U → DependencyTree parser (pure TS, TDD)

**Files:**
- Create: `/Users/binitmohanty/Source/udpipe-wasm/src/types.ts`
- Create: `/Users/binitmohanty/Source/udpipe-wasm/src/conllu.ts`
- Test: `/Users/binitmohanty/Source/udpipe-wasm/test/conllu.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface UDToken { id: number; form: string; lemma: string; upos: string; head: number; deprel: string }`
  - `interface DependencyTree { tokens: UDToken[]; root(): UDToken | null; children(id: number): UDToken[] }`
  - `function parseConllu(conllu: string): DependencyTree`

- [ ] **Step 1: Write the failing test**

`test/conllu.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseConllu } from "../src/conllu";

// Real UDPipe output for "I hate my job." (from the feasibility spike).
const CONLLU = `# sent_id = 1
# text = I hate my job.
1\tI\tI\tPRON\tPRP\tCase=Nom\t2\tnsubj\t_\t_
2\thate\thate\tVERB\tVBP\tTense=Pres\t0\troot\t_\t_
3\tmy\tmy\tPRON\tPRP$\tPoss=Yes\t4\tnmod:poss\t_\t_
4\tjob\tjob\tNOUN\tNN\tNumber=Sing\t2\tobj\t_\tSpaceAfter=No
5\t.\t.\tPUNCT\t.\t_\t2\tpunct\t_\t_
`;

describe("parseConllu", () => {
  it("parses tokens with id/form/lemma/upos/head/deprel", () => {
    const tree = parseConllu(CONLLU);
    expect(tree.tokens).toHaveLength(5);
    expect(tree.tokens[0]).toEqual({
      id: 1, form: "I", lemma: "I", upos: "PRON", head: 2, deprel: "nsubj",
    });
  });

  it("root() returns the deprel=root token", () => {
    expect(parseConllu(CONLLU).root()?.form).toBe("hate");
  });

  it("children() returns tokens whose head is the given id", () => {
    const tree = parseConllu(CONLLU);
    expect(tree.children(2).map((t) => t.form).sort()).toEqual(["I", ".", "job"].sort());
  });

  it("skips multiword-token ranges and empty nodes", () => {
    const mwt = `1-2\tdon't\t_\t_\t_\t_\t_\t_\t_\t_
1\tdo\tdo\tAUX\tVBP\t_\t3\taux\t_\t_
2\tn't\tnot\tPART\tRB\t_\t3\tadvmod\t_\t_
3\tgo\tgo\tVERB\tVB\t_\t0\troot\t_\t_
3.1\t_\t_\t_\t_\t_\t_\t_\t_\t_
`;
    const tree = parseConllu(mwt);
    expect(tree.tokens.map((t) => t.id)).toEqual([1, 2, 3]);
  });

  it("returns an empty-token tree for blank input and root() is null", () => {
    const tree = parseConllu("");
    expect(tree.tokens).toEqual([]);
    expect(tree.root()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/conllu.test.ts`
Expected: FAIL — `Failed to resolve import "../src/conllu"`.

- [ ] **Step 3: Write `src/types.ts`**

```ts
/** One surface token of a Universal Dependencies parse. */
export interface UDToken {
  id: number;
  form: string;
  lemma: string;
  upos: string;
  /** id of the syntactic head; 0 means the sentence root. */
  head: number;
  deprel: string;
}

export interface DependencyTree {
  tokens: UDToken[];
  /** The token with deprel === "root", or null if none. */
  root(): UDToken | null;
  /** Tokens whose head === id (i.e. direct dependents). */
  children(id: number): UDToken[];
}
```

- [ ] **Step 4: Write `src/conllu.ts`**

```ts
import type { UDToken, DependencyTree } from "./types";

/**
 * Parse a CoNLL-U string (one sentence's worth is typical) into a flat token
 * list plus tree helpers. Multiword-token ranges ("1-2") and empty nodes
 * ("3.1") are skipped — only surface tokens carry a head/deprel.
 */
export function parseConllu(conllu: string): DependencyTree {
  const tokens: UDToken[] = [];
  for (const line of conllu.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const c = line.split("\t");
    if (c.length < 8) continue;
    const id = c[0];
    if (id.includes("-") || id.includes(".")) continue; // mwt range / empty node
    tokens.push({
      id: Number(id),
      form: c[1],
      lemma: c[2],
      upos: c[3],
      head: Number(c[6]),
      deprel: c[7],
    });
  }
  return {
    tokens,
    root: () => tokens.find((t) => t.deprel === "root") ?? null,
    children: (id: number) => tokens.filter((t) => t.head === id),
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/conllu.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/conllu.ts test/conllu.test.ts
git commit -m "feat: CoNLL-U to DependencyTree parser with root()/children() helpers"
```

---

### Task 3: Embind binding + reproducible wasm build

**Files:**
- Create: `/Users/binitmohanty/Source/udpipe-wasm/build/binding.cpp`
- Create: `/Users/binitmohanty/Source/udpipe-wasm/build/build.sh`
- Create: `/Users/binitmohanty/Source/udpipe-wasm/build/README.md`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces build artifacts in `src/` (gitignored; copied to `dist/` by `build:ts`):
  - `udpipe.glue.js` — Emscripten MODULARIZE factory named `createUDPipe`.
  - `udpipe.wasm`.
  - Runtime surface used by Task 4: `Module.FS.writeFile(path, Uint8Array)`, `Module.initModel(path: string): boolean`, `Module.parseToConllu(text: string): string` (returns CoNLL-U, or a string starting with `"ERROR:"`).

- [ ] **Step 1: Write the Embind binding**

`build/binding.cpp`:
```cpp
// Embind binding for udpipe-wasm. Model bytes are written to MEMFS by JS, then
// initModel() loads from that path; parseToConllu() runs tokenize->tag->parse.
#include <emscripten/bind.h>
#include <sstream>
#include <string>
#include "udpipe.h"

using namespace emscripten;
using namespace ufal::udpipe;

static model* g_model = nullptr;

bool initModel(std::string path) {
  if (g_model) { delete g_model; g_model = nullptr; }
  g_model = model::load(path.c_str());
  return g_model != nullptr;
}

std::string parseToConllu(std::string text) {
  if (!g_model) return std::string("ERROR: model not loaded");
  pipeline pipe(g_model, "tokenizer", pipeline::DEFAULT, pipeline::DEFAULT, "conllu");
  std::istringstream is(text);
  std::ostringstream os;
  std::string error;
  if (!pipe.process(is, os, error)) return std::string("ERROR: ") + error;
  return os.str();
}

EMSCRIPTEN_BINDINGS(udpipe_wasm) {
  function("initModel", &initModel);
  function("parseToConllu", &parseToConllu);
}
```

- [ ] **Step 2: Write the build script**

`build/build.sh`:
```bash
#!/usr/bin/env bash
# Reproducible udpipe-wasm build.
#  1. (host) clone pinned UDPipe, merge src_lib_only into one udpipe.cpp
#  2. (docker, pinned emscripten) compile udpipe.cpp + binding.cpp -> wasm + glue
set -euo pipefail

UDPIPE_REF="v1.3.1"
EMSCRIPTEN_IMAGE="emscripten/emsdk:3.1.74"   # ships emscripten 3.x; pin exactly
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$ROOT/build/.work"
OUT="$ROOT/src"   # glue + wasm land beside the TS sources (gitignored); do NOT rm this dir

rm -rf "$WORK"
rm -f "$OUT/udpipe.glue.js" "$OUT/udpipe.wasm"   # remove only our artifacts, never the src tree
mkdir -p "$WORK"

# --- 1. host: fetch pinned source and merge into a single translation unit ---
git clone --depth 1 --branch "$UDPIPE_REF" https://github.com/ufal/udpipe.git "$WORK/udpipe"
( cd "$WORK/udpipe/src_lib_only" && make udpipe.cpp )
cp "$WORK/udpipe/src_lib_only/udpipe.cpp" "$WORK/"
cp "$WORK/udpipe/src_lib_only/udpipe.h"   "$WORK/"
cp "$ROOT/build/binding.cpp"              "$WORK/"

# --- 2. docker: pinned emscripten compile ---
docker run --rm -v "$WORK":/src -w /src "$EMSCRIPTEN_IMAGE" \
  em++ -Oz -std=c++17 udpipe.cpp binding.cpp -I. --bind \
    -s MODULARIZE=1 -s EXPORT_NAME=createUDPipe \
    -s ENVIRONMENT=web,worker,node \
    -s ALLOW_MEMORY_GROWTH=1 -s FORCE_FILESYSTEM=1 \
    -s 'EXPORTED_RUNTIME_METHODS=["FS","callMain"]' \
    -o udpipe.glue.js

cp "$WORK/udpipe.glue.js" "$OUT/"
cp "$WORK/udpipe.wasm"    "$OUT/"
echo "built: $OUT/udpipe.glue.js $OUT/udpipe.wasm"
ls -lh "$OUT/udpipe.glue.js" "$OUT/udpipe.wasm"
```

> Note on the pin: the spike used Homebrew emscripten 6.0.1; this Docker image tag pins a specific emscripten for CI reproducibility. Before relying on `UDPIPE_REF` and the image tag, the implementer MUST verify both exist (next step) and adjust if a tag is missing — a wrong tag fails loudly at clone/pull.

- [ ] **Step 3: Verify the pinned refs exist, then build**

Run:
```bash
cd /Users/binitmohanty/Source/udpipe-wasm
git ls-remote --tags https://github.com/ufal/udpipe.git | grep -E 'refs/tags/v1\.3\.1$' || echo "PIN MISSING: pick an existing tag from the list above"
docker pull emscripten/emsdk:3.1.74
chmod +x build/build.sh
npm run build:wasm
```
Expected: `src/udpipe.glue.js` and `src/udpipe.wasm` exist (gitignored); wasm is ~0.5–1 MB.

- [ ] **Step 4: Smoke-test the artifacts compile and expose the API**

Run:
```bash
cd /Users/binitmohanty/Source/udpipe-wasm
node --input-type=module -e '
import { createRequire } from "module";
const require = createRequire(process.cwd() + "/");
const createUDPipe = require("./src/udpipe.glue.js");
const M = await createUDPipe();
console.log("FS:", typeof M.FS?.writeFile, "initModel:", typeof M.initModel, "parseToConllu:", typeof M.parseToConllu);
'
```
Expected: `FS: function initModel: function parseToConllu: function`.

- [ ] **Step 5: Write `build/README.md`**

```markdown
# Build

`bash build/build.sh` produces `src/udpipe.{glue.js,wasm}` (gitignored), which the
`build:ts` npm script then copies into `dist/`.

- **Host step:** clones UDPipe `v1.3.1`, runs `make udpipe.cpp` in `src_lib_only`
  to merge all sources into one translation unit (needs any C++ compiler).
- **Docker step:** pinned `emscripten/emsdk:3.1.74` compiles the merged source +
  `binding.cpp` with `-Oz -std=c++17 --bind` into wasm + glue.

The model is **not** built or bundled here — it is fetched at runtime by the
consumer (see top-level README, bring-your-own-model).
```

- [ ] **Step 6: Commit**

```bash
git add build/binding.cpp build/build.sh build/README.md
git commit -m "feat: Embind binding + reproducible Dockerized wasm build"
```

---

### Task 4: `loadParser` wrapper + golden end-to-end parse (TDD)

**Files:**
- Create: `/Users/binitmohanty/Source/udpipe-wasm/src/index.ts`
- Create: `/Users/binitmohanty/Source/udpipe-wasm/test/fetch-model.sh`
- Test: `/Users/binitmohanty/Source/udpipe-wasm/test/parse.e2e.test.ts`

**Interfaces:**
- Consumes: `parseConllu` (Task 2); the glue runtime surface `FS.writeFile` / `initModel` / `parseToConllu` (Task 3).
- Produces:
  - `interface LoadOptions { modelUrl: string; wasmUrl?: string }`
  - `interface Parser { parse(text: string): DependencyTree }`
  - `function loadParser(opts: LoadOptions): Promise<Parser>` (singleton per process; caches the instantiated module).
  - Re-exports `UDToken`, `DependencyTree`, `parseConllu`.

- [ ] **Step 1: Write the model-fetch helper (for local/e2e runs)**

`test/fetch-model.sh`:
```bash
#!/usr/bin/env bash
# Downloads the english-ewt UD 2.5 model used by the e2e test. ~16 MB.
set -euo pipefail
DEST="$(cd "$(dirname "$0")" && pwd)/fixtures/english-ewt.udpipe"
URL="https://raw.githubusercontent.com/jwijffels/udpipe.models.ud.2.5/master/inst/udpipe-ud-2.5-191206/english-ewt-ud-2.5-191206.udpipe"
if [ -s "$DEST" ]; then echo "model present: $DEST"; exit 0; fi
curl -sL -o "$DEST" "$URL"
echo "downloaded $(ls -lh "$DEST" | awk '{print $5}') -> $DEST"
```

- [ ] **Step 2: Write the failing end-to-end test**

`test/parse.e2e.test.ts`:
```ts
import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadParser, type Parser } from "../src/index";

const MODEL = fileURLToPath(new URL("./fixtures/english-ewt.udpipe", import.meta.url));
const GLUE = fileURLToPath(new URL("../src/udpipe.glue.js", import.meta.url));

// e2e needs the built glue + the model; skip (don't fail) when absent so the
// pure-TS suite stays green in environments without them.
const ready = existsSync(MODEL) && existsSync(GLUE);
const d = ready ? describe : describe.skip;

d("loadParser end-to-end", () => {
  let parser: Parser;
  beforeAll(async () => {
    // Node has no fetch-from-disk; provide the model bytes via a data URL.
    const bytes = readFileSync(MODEL);
    const modelUrl = `data:application/octet-stream;base64,${bytes.toString("base64")}`;
    parser = await loadParser({ modelUrl, wasmUrl: fileURLToPath(new URL("../src/udpipe.wasm", import.meta.url)) });
  }, 60_000);

  it("parses 'I hate my job.' into the expected dependency relations", () => {
    const tree = parser.parse("I hate my job.");
    expect(tree.root()?.form).toBe("hate");
    const nsubj = tree.tokens.find((t) => t.deprel === "nsubj");
    expect(nsubj?.form).toBe("I");
    const obj = tree.tokens.find((t) => t.deprel === "obj");
    expect(obj?.form).toBe("job");
  });

  it("returns an empty-token tree for blank input without throwing", () => {
    expect(parser.parse("").tokens).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/parse.e2e.test.ts`
Expected: FAIL — `Failed to resolve import "../src/index"`. (If the model/glue are absent the block would skip, but the import error fails collection first — that is the failure we want.)

- [ ] **Step 4: Write `src/index.ts`**

```ts
import { parseConllu } from "./conllu";
import type { DependencyTree, UDToken } from "./types";

export type { UDToken, DependencyTree };
export { parseConllu };

export interface LoadOptions {
  /** URL (or data:/file: URL) of a UDPipe model. Required — model is not bundled. */
  modelUrl: string;
  /** Optional override for locating udpipe.wasm (defaults to package-relative). */
  wasmUrl?: string;
}

export interface Parser {
  parse(text: string): DependencyTree;
}

interface UDPipeModule {
  FS: { writeFile(path: string, data: Uint8Array): void };
  initModel(path: string): boolean;
  parseToConllu(text: string): string;
}

// @ts-expect-error - emitted glue has no types; built beside this file by build:wasm.
import createUDPipe from "./udpipe.glue.js";

let cached: Promise<Parser> | null = null;

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`udpipe: model fetch failed (${res.status}) for ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

export function loadParser(opts: LoadOptions): Promise<Parser> {
  if (cached) return cached;
  cached = (async () => {
    const factoryOpts = opts.wasmUrl ? { locateFile: () => opts.wasmUrl! } : {};
    const mod = (await createUDPipe(factoryOpts)) as UDPipeModule;
    const bytes = await fetchBytes(opts.modelUrl);
    mod.FS.writeFile("/model.udpipe", bytes);
    if (!mod.initModel("/model.udpipe")) {
      cached = null;
      throw new Error("udpipe: model failed to load");
    }
    return {
      parse(text: string): DependencyTree {
        const conllu = mod.parseToConllu(text);
        if (conllu.startsWith("ERROR:")) throw new Error(`udpipe: ${conllu.slice(7).trim()}`);
        return parseConllu(conllu);
      },
    };
  })();
  return cached;
}
```

- [ ] **Step 5: Fetch the model and run the e2e test**

Run:
```bash
cd /Users/binitmohanty/Source/udpipe-wasm
chmod +x test/fetch-model.sh && npm run fetch:model
npx vitest run test/parse.e2e.test.ts
```
Expected: PASS (2 tests). If the wasm build (Task 3) has not been run, the suite SKIPS — run `npm run build:wasm` first, then re-run.

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run`
Expected: PASS — Task 2's `conllu.test.ts` (5) + this e2e (2, or skipped if artifacts absent).

- [ ] **Step 7: Commit**

```bash
git add src/index.ts test/parse.e2e.test.ts test/fetch-model.sh
git commit -m "feat: loadParser wrapper (BYO-model) + golden end-to-end parse test"
```

---

### Task 5: Package build wiring, README, and publish prep

**Files:**
- Create: `/Users/binitmohanty/Source/udpipe-wasm/README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: a `dist/` containing `index.js`, `index.d.ts`, `udpipe.glue.js`, `udpipe.wasm` — an installable package.

- [ ] **Step 1: Run the full build and inspect `dist/`**

Run:
```bash
cd /Users/binitmohanty/Source/udpipe-wasm
npm run build
ls -lh dist
```
Expected: `dist/index.js`, `dist/index.d.ts`, `dist/udpipe.glue.js`, `dist/udpipe.wasm` all present.

- [ ] **Step 2: Verify the compiled glue import resolves same-dir**

Because `src/index.ts` imports `./udpipe.glue.js`, tsc preserves that specifier verbatim, and `build:ts` copies the glue beside `dist/index.js`. Confirm:
```bash
grep -n 'udpipe.glue.js' dist/index.js
```
Expected: the emitted import reads `from "./udpipe.glue.js"` — a sibling of `dist/index.js`. (No edit should be needed; this is a guard.)

- [ ] **Step 3: Verify the package contents that would publish**

Run: `npm pack --dry-run`
Expected: the tarball lists `dist/index.js`, `dist/index.d.ts`, `dist/udpipe.glue.js`, `dist/udpipe.wasm` — and **no** `.udpipe` model file.

- [ ] **Step 4: Write the top-level `README.md`**

````markdown
# udpipe-wasm

Browser-local dependency parsing. [UDPipe](https://github.com/ufal/udpipe)
compiled to WebAssembly: tokenize, tag, and parse English to a Universal
Dependencies tree — no server, no network at parse time.

## Install

```bash
npm install udpipe-wasm
```

## Bring your own model

The model is **not bundled** (the UD 2.5 models are CC BY-NC-SA; bundling would
impose that on every consumer). Download one and host it yourself:

```bash
curl -L -o english-ewt.udpipe \
  https://raw.githubusercontent.com/jwijffels/udpipe.models.ud.2.5/master/inst/udpipe-ud-2.5-191206/english-ewt-ud-2.5-191206.udpipe
```

## Usage

```ts
import { loadParser } from "udpipe-wasm";

const parser = await loadParser({ modelUrl: "/models/english-ewt.udpipe" });
const tree = parser.parse("I hate my job.");

tree.root();          // { form: "hate", deprel: "root", ... }
tree.children(2);     // dependents of token 2
tree.tokens.find((t) => t.deprel === "nsubj"); // { form: "I", ... }
```

`loadParser` fetches the wasm + model once (singleton) and rejects on failure.
`parse()` runs on the main thread (single-digit ms for short sentences) and
returns an empty-token tree for blank input rather than throwing.

## License

MPL-2.0 (matching UDPipe). Models are licensed separately by their providers.
````

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: README + verify model excluded from npm tarball"
```

---

## Consumer follow-up (out of scope for this plan, noted for continuity)

words-for-the-unwise will later depend on this package, host its own copy of
`english-ewt.udpipe` under `public/udpipe/`, and call `loadParser` lazily from the
`/chat` fallback tier. That wiring belongs to **spec #2 (chat reply cascade)** and
its own plan — not here.
