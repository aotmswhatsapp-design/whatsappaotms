import { Injectable } from "@nestjs/common";

import { LocalKnowledgeSearch } from "./search/local.search";
import type { SearchResult, SearchScope } from "./search/search.port";

// `reply.prompt.ts` and its tests read `ContextChunk` from here, so the type
// keeps its home even though the vector engine that used to live beside it is
// gone.
export type { ContextChunk } from "./search/context-chunk";

/**
 * The one seam the reply path talks to.
 *
 * The engine is Postgres itself; this class exists so the reply path names the
 * operation rather than a SQL implementation, and so one constructor change
 * could ever re-point it. There is nothing to select at boot.
 */
@Injectable()
export class RetrievalService {
  constructor(private readonly engine: LocalKnowledgeSearch) {}

  search(scope: SearchScope, question: string): Promise<SearchResult> {
    return this.engine.search(scope, question);
  }
}
