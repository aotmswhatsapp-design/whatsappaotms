import type { ContextChunk } from "./context-chunk";

/** What one question cost the engine: the passages, and the tokens it spent. */
export interface SearchResult {
  chunks: ContextChunk[];
  /** Embedding tokens. Always zero for the local engine, which calls nobody. */
  embedTokens: number;
}

/** Whose material may be read. The workspace is a predicate, not an inference
 *  from the agent id: a source row whose agent moved between tenants must not
 *  answer here. */
export interface SearchScope {
  agentId: string;
  workspaceId: string;
}

/**
 * The only thing the reply path knows about search.
 *
 * Two engines implement this and exactly one is wired at boot, chosen by
 * `KNOWLEDGE_SEARCH`. Both return the same rows in the same shape, so the
 * caller cannot tell which one answered — which is what makes the switch a
 * configuration change rather than a rewrite, and what lets the Playground and
 * WhatsApp share one engine.
 */
export interface KnowledgeSearch {
  readonly mode: "local" | "vector";
  search(scope: SearchScope, question: string): Promise<SearchResult>;
}

/** Injection token: an interface has no runtime identity to inject by. */
export const KNOWLEDGE_SEARCH = Symbol("KNOWLEDGE_SEARCH");
