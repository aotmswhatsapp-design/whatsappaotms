import { Inject, Injectable } from "@nestjs/common";

import {
  KNOWLEDGE_SEARCH,
  type KnowledgeSearch,
  type SearchResult,
  type SearchScope,
} from "./search/search.port";

// The vector engine's policy lives beside the engine that applies it, but it
// is re-exported here because this module was its home: `reply.prompt.ts`
// still reads `ContextChunk` from here, and its tests read the floors.
export {
  FLOOR,
  RETRY_FLOOR,
  RETRY_K,
  TOP_K,
  rank,
} from "./search/vector.rank";
export type { ContextChunk } from "./search/context-chunk";

/**
 * The one seam the reply path talks to.
 *
 * Which engine answers is decided once, at wiring time, by `KNOWLEDGE_SEARCH`.
 * Everything downstream — the WhatsApp reply, the Playground, the citations —
 * sees the same rows in the same shape, so switching engines never becomes a
 * second code path through the answer.
 */
@Injectable()
export class RetrievalService {
  constructor(
    @Inject(KNOWLEDGE_SEARCH) private readonly engine: KnowledgeSearch,
  ) {}

  /** The engine in use, for the one diagnostic worth writing down. */
  get mode(): "local" | "vector" {
    return this.engine.mode;
  }

  search(scope: SearchScope, question: string): Promise<SearchResult> {
    return this.engine.search(scope, question);
  }
}
