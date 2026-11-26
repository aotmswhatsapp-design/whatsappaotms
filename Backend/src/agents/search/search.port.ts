import type { ContextChunk } from "./context-chunk";

/** What one question returned: the passages that answer it. */
export interface SearchResult {
  chunks: ContextChunk[];
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
 * One engine implements it: Postgres full text and trigram over the
 * workspace's own chunks. There is no second engine to select, so there is no
 * mode, no boot-time switch and no fallback path — the Playground and WhatsApp
 * are answered by the same rows.
 */
export interface KnowledgeSearch {
  search(scope: SearchScope, question: string): Promise<SearchResult>;
}
