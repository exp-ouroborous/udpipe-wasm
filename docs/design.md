# `udpipe-wasm` — Browser-Local Dependency Parser — Design

Date: 2026-06-23
Status: **GO** — feasibility spike passed 2026-06-23 (see [Spike results](#spike-results-2026-06-23))

## Summary

A standalone, open-source WebAssembly build of [UDPipe](https://github.com/ufal/udpipe)
that runs a full dependency parse **entirely in the browser** and exposes one
clean TypeScript interface:

```ts
parse(text: string): DependencyTree   // tokens with head + deprel (nsubj, root, dobj, …)
```

There is currently **no maintained UDPipe-wasm / npm package** (verified
2026-06-23: UDPipe ships as C++ with Python/Java/C#/Perl/R bindings and a REST
web service, but nothing browser-native). This project fills that gap.

This is **sub-project 1 of 2**. Its first consumer is the words-for-the-unwise
`/chat` reply engine (spec #2, deferred), which needs a real syntactic tree so an
ELIZA-style reflector can reflect on grammar (subject/verb/object) rather than
regex patterns. But `udpipe-wasm` depends on nothing in this site and is designed
to be **published and reused by others**.

The single biggest risk — does UDPipe compile to an acceptable size and parse
fast enough for an interactive per-message path? — is retired **first**, by a
throwaway feasibility spike that gates the rest of the work.

## Motivation & context

- The `/chat` feature's replies feel disconnected because the runtime selector
  ([src/lib/chatSelector.ts](../../../src/lib/chatSelector.ts)) ignores message
  content — it rotates pre-baked strings by turn number, with mood as the only
  signal. The fix is to make message-time replies actually consume the user's
  text, under a hard constraint: **no per-message server LLM call**.
- The chosen design is a tiered cascade (spec #2). Its fallback tier is an
  ELIZA-style Rogerian reflector that echoes the user's words back, flavored with
  the day's surreal theme. A real dependency parse makes that reflector
  substantially better — but the ideal tool (UDPipe) doesn't exist in our runtime.
- Rather than vendor a half-measure, we build the missing piece cleanly and
  release it. Precedent: the `/learn` dives (`pyodide-dives`, `misc-dives`) are
  already separate repos consumed by this site via reverse-proxy.

## Goals

1. A browser-loadable WASM build of UDPipe that parses English to a dependency
   tree, lazy-loaded and fast enough for an interactive chat reply.
2. A small, typed TS wrapper with a stable interface independent of UDPipe
   internals (consumers depend only on `loadParser` / `parse`).
3. Shippable as an **open-source library**: permissively-licensed wasm + wrapper
   on npm; **model not bundled** (bring-your-own-model).
4. A reproducible, documented build (pinned Emscripten toolchain).

## Non-goals (v1)

- Languages other than English (the interface allows it; we ship one model path).
- Training, pruning, or distilling custom models.
- Server-side / Node parsing (browser is the target; Node may work but is untested).
- Integration with `/corpus` (possible future reuse; out of scope here).
- A Web Worker wrapper **unless** the spike shows main-thread latency is too high.
- The `/chat` reply cascade itself — that is spec #2.

## The feasibility spike — go/no-go gate (DO THIS FIRST)

A throwaway Emscripten compile of `ufal/udpipe` + the English-EWT model, parsing a
handful of sentences in a headless browser, that **measures and reports**:

| Metric | Proposed gate |
|---|---|
| wasm binary size (brotli/gzip served) | model + wasm ≤ ~20 MB compressed |
| warm per-sentence parse latency (short message) | < ~200 ms |
| cold init (fetch + instantiate + model load) | < ~3 s |
| peak memory | fits comfortably in a tab (no OOM) |

Plus two non-perf gate items:

- **License clearance.** UDPipe *software* is MPL-2.0 (redistributable). The
  LINDAT-hosted *models* are typically **CC BY-NC-SA** (non-commercial). For the
  non-commercial words-for-the-unwise site that is acceptable; for the **public
  package** the resolution is to **not bundle the model** — ship the loader and
  let users fetch their own (or point to a permissively-licensed model). Confirm
  the specific English model's license text before depending on it.
- **Threading decision.** Based on measured latency, decide main-thread vs. Web
  Worker. Do not build the Worker unless the numbers require it.

**If any gate fails:** stop and fall back to the `compromise` shallow-tree seam.
Spec #2's cascade only needs *a* tree, so only this sub-project changes — the chat
design survives. Record spike results in this doc before proceeding.

## Spike results (2026-06-23)

A throwaway native-Emscripten build (Homebrew emscripten 6.0.1, `-O2 -std=c++17`)
of UDPipe's `src_lib_only` single-source bundle + a small Embind binding
(`initModel` / `parseToConllu`), with the **english-ewt-ud-2.5** model
(16 MB, from the `jwijffels/udpipe.models.ud.2.5` GitHub mirror) preloaded into
MEMFS. Parsed in Node 26. **Every gate passed, most with wide margin:**

| Metric | Gate | Measured | Verdict |
|---|---|---|---|
| wasm + glue (code) | — | 253 KB gzip (wasm 230 KB + js 23 KB) | negligible |
| model | — | 16.3 MB (already internally compressed; gzip is a no-op) | dominates payload |
| total payload | ≤ ~20 MB gzip | **16.6 MB** | ✅ |
| warm parse latency | < ~200 ms | **3.4 ms avg, 4.0 ms max** (5 short sentences) | ✅ ~50× margin |
| cold init | < ~3 s | **~0.73 s** (8 ms runtime instantiate + 717 ms model load) | ✅ |
| peak memory | no OOM | 204 MB Node RSS (incl. Node baseline) | ✅ |
| license | redistributable | software **MPL-2.0** ✅; model CC BY-NC-SA → resolved by BYO-model | ✅ |

Parse quality is exactly what the ELIZA consumer needs. Example —
`"I hate my job."`:

```text
1  I      PRON   head=2  nsubj
2  hate   VERB   head=0  root
3  my     PRON   head=4  nmod:poss
4  job    NOUN   head=2  obj
5  .      PUNCT  head=2  punct
```

The reflector recipe falls straight out of the tree: take `root`, person-swap its
`nsubj`, echo its `obj`. Confirmed equally clean on interrogatives (`advmod`/`aux`),
ditransitives (`iobj`/`obj`), and control verbs (`xcomp`/`ccomp`).

**Findings that update the design:**

1. **The model is the entire cost.** Compiled code is ~250 KB gzip; all future
   size work is model-side (smaller UD model or pruning), never compilation. The
   ~16 MB one-time, cacheable model fetch is the real UX cost — acceptable for v1,
   model-size reduction noted as a future optimization.
2. **No Web Worker needed for parsing** (3–4 ms, main-thread-safe). The only
   blocking moment is the one-time ~717 ms model load; hide it behind a loading
   state, or Worker-load just the model. The general-purpose Worker wrapper stays
   a non-goal.
3. **Build needs `-std=c++17`** (Embind requires ≥C++14; UDPipe's C++11 source
   compiles cleanly under 17). The real Dockerized build should pin this.

Conclusion: proceed to the implementation plan for the standalone library.

## Architecture

Three layers, built in order after the spike passes:

### 1. C++ → WASM build (`udpipe-wasm` repo, build/)

- Compile UDPipe's embeddable C++ core with Emscripten. UDPipe is small,
  dependency-light C++ designed to be embedded, which is what makes it a
  realistic WASM target (it is the reference UD parser).
- Expose a minimal entry via Embind: load a model from bytes once, then
  `parseToConllu(text) -> string`. The C++ side runs tokenizer → tagger → parser
  → CoNLL-U writer (UDPipe's built-in pipeline). We deliberately return CoNLL-U
  text and parse it in TS, rather than marshalling a struct across the boundary —
  simpler, debuggable, and CoNLL-U is the canonical format.
- Output artifacts: `udpipe.wasm` + Emscripten glue JS.
- Pin the Emscripten SDK version; build runs in a Dockerfile for reproducibility,
  out-of-band (not at consumer app build time), mirroring how `public/corpus/`
  data is prebuilt by scripts here.

### 2. TS wrapper (`src/` of the lib; published to npm)

```ts
interface UDToken {
  id: number; form: string; lemma: string;
  upos: string; head: number; deprel: string;
}
interface DependencyTree {
  tokens: UDToken[];
  root(): UDToken | null;            // the deprel === "root" token
  children(id: number): UDToken[];   // tokens whose head === id
}
interface LoadOptions {
  wasmUrl?: string;                  // default: package-relative
  modelUrl: string;                  // REQUIRED — bring your own model
}
loadParser(opts: LoadOptions): Promise<Parser>;   // singleton; fetch + instantiate once
// Parser:
parser.parse(text: string): DependencyTree;        // sync after load
```

- `loadParser` fetches the wasm + the caller-supplied model URL, instantiates,
  keeps the model resident, returns a handle. Idempotent / singleton.
- `parse` is synchronous after load; the wrapper parses the CoNLL-U output into
  `DependencyTree` and provides `root()` / `children()` helpers.
- **Model is never bundled** — `modelUrl` is required. The library README
  documents where to get a model and the license caveat.

### 3. Consumption by words-for-the-unwise

- The site hosts its **own copy** of the English model as a static asset
  (e.g. `public/udpipe/english-ewt.udpipe`), served like `public/corpus/`.
- It depends on the published package (npm) — or, if release is deferred, on
  pinned vendored artifacts — and calls `loadParser({ modelUrl: "/udpipe/…" })`
  lazily, only when the chat fallback tier actually needs a parse.

## Error handling

- `loadParser` **rejects cleanly** on network failure, missing/incompatible
  WebAssembly, model-fetch failure, or OOM. The parser is therefore **optional at
  runtime**: the consumer (chat cascade) must have a non-tree ELIZA floor so a
  parser-load failure degrades gracefully rather than breaking chat. (Design note
  carried into spec #2.)
- `parse` on malformed/empty input returns an empty-token tree, never throws.

## Testing

- **Reproducible build:** pinned Emscripten version documented; build in Docker.
- **Wrapper unit tests:** CoNLL-U fixtures → assert `DependencyTree` shape,
  `root()`, and `children()`.
- **Golden end-to-end:** parse a fixed sentence (e.g. "I hate my job") → assert
  the expected `nsubj` / `root` / `dobj` relations. This is the test that proves
  the whole pipeline, not just the CoNLL-U parser.
- **Budget check:** the spike's size/latency numbers recorded as a documented
  manual measurement (optionally a perf smoke test).

## Build & release

- Develop as its own **public open-source repo** from day one.
- Public artifact = wasm + TS wrapper, permissive license, **no model**.
- npm publish is a milestone **gated on the spike passing** + license clearance.
- words-for-the-unwise consumes it and hosts its own model copy.

## Open items / deferred

- Multi-language model support (interface already allows a `modelUrl`).
- Optional Web Worker build (decided by spike latency).
- Possible `/corpus` reuse of the same parser later.
- **Spec #2 — `/chat` reply cascade** (Tier A on-device generation, Tier B
  ELIZA-over-the-tree, Tier C canned, daily-bank enrichment with `lexicon` +
  `personaSeed`). Written only after this sub-project's spike passes and the
  `parse()` interface is firm.
