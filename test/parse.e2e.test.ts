import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadParser, type Parser } from "../src/index";

const MODEL = fileURLToPath(new URL("./fixtures/english-ewt.udpipe", import.meta.url));
const GLUE = fileURLToPath(new URL("../src/udpipe.glue.cjs", import.meta.url));

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
    parser = await loadParser({
      modelUrl,
      wasmUrl: fileURLToPath(new URL("../src/udpipe.wasm", import.meta.url)),
    });
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
