# udpipe-wasm

Browser-local dependency parsing. [UDPipe](https://github.com/ufal/udpipe)
compiled to WebAssembly: tokenize, tag, and parse text into a Universal
Dependencies tree — no server, no network at parse time.

- **Tiny:** ~210 kB package (wasm + glue); single-digit-millisecond parses.
- **Real syntax:** full dependency tree (`nsubj`, `root`, `obj`, …), not just POS tags.
- **Bring-your-own-model:** the parser ships without a model (see below).

## Install

```bash
npm install udpipe-wasm
```

## Bring your own model

The model is **not bundled**. The UD 2.5 models are CC BY-NC-SA, so bundling one
would impose that licence on every consumer. Download a model and host it
yourself:

```bash
curl -L -o english-ewt.udpipe \
  https://raw.githubusercontent.com/jwijffels/udpipe.models.ud.2.5/master/inst/udpipe-ud-2.5-191206/english-ewt-ud-2.5-191206.udpipe
```

Serve it as a static asset (e.g. `/models/english-ewt.udpipe`).

## Usage

```ts
import { loadParser } from "udpipe-wasm";

const parser = await loadParser({ modelUrl: "/models/english-ewt.udpipe" });
const tree = parser.parse("I hate my job.");

tree.root();          // { form: "hate", deprel: "root", head: 0, ... }
tree.children(2);     // direct dependents of token 2
tree.tokens.find((t) => t.deprel === "nsubj"); // { form: "I", ... }
```

`loadParser` fetches the wasm + model once (singleton) and rejects on failure.
`parse()` runs on the main thread (single-digit ms for short sentences) and
returns an empty-token tree for blank input rather than throwing.

### API

```ts
function loadParser(opts: { modelUrl: string; wasmUrl?: string }): Promise<Parser>;

interface Parser {
  parse(text: string): DependencyTree;
}

interface UDToken {
  id: number; form: string; lemma: string;
  upos: string; head: number; deprel: string;
}

interface DependencyTree {
  tokens: UDToken[];
  root(): UDToken | null;          // the deprel === "root" token
  children(id: number): UDToken[]; // tokens whose head === id
}
```

`parseConllu(conllu: string): DependencyTree` is also exported, if you already
have CoNLL-U from elsewhere.

## Building from source

See [build/README.md](build/README.md). `npm run build` clones pinned UDPipe
`v1.3.1`, compiles it with Emscripten (`-Oz -std=c++17`), and emits the wasm +
glue into `dist/`.

## License

[MPL-2.0](LICENSE) (matching UDPipe). Models are licensed separately by their
providers.
