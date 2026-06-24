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
import createUDPipe from "./udpipe.glue.cjs";

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
