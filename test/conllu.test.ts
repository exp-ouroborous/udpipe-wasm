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
