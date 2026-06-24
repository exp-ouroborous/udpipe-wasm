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
