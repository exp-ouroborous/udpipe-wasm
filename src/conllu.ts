import type { UDToken, DependencyTree } from "./types.js";

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
