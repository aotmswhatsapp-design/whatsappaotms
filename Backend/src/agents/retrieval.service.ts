import { Injectable } from "@nestjs/common";

import { LocalKnowledgeSearch } from "./search/local.search";
import type { SearchResult, SearchScope } from "./search/search.port";

// The type that describes one result. It is re-exported here because this is
// the seam every caller already imports from.
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
