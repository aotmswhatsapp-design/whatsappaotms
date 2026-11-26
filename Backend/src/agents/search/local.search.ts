import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { PrismaService } from "../../prisma/prisma.service";
import { CANDIDATES } from "./limits";
import { normalize, type Normalized } from "./normalize";
import { type LocalHit, selectRelevant } from "./score";
import type { KnowledgeSearch, SearchResult, SearchScope } from "./search.port";

/** The trigram floor a corpus with no words in common still has to clear. */
const DEFAULT_MIN_SIMILARITY = 0.5;

interface Row {
  id: string;
  text: string;
  source_id: string;
  title: string;
  mime: string | null;
  page: number | null;
  sheet: string | null;
  row_from: number | null;
  row_to: number | null;
  heading: string | null;
  rank: number;
  similarity: number;
  all_terms: boolean;
  some_terms: boolean;
}

/**
 * Search that needs nothing but the database.
 *
 * Three signals, layered so that the strongest available evidence decides:
 *
 * 1. Full text (`to_tsvector` / `websearch_to_tsquery`) over every term — a
 *    chunk containing all of them.
 * 2. Full text over any term — a chunk containing one of them.
 * 3. Trigram (`word_similarity`) — spelling variation and partial phrases,
 *    which no stemming dictionary would catch.
 *
 * The question is normalised here, in TypeScript, and never in the database:
 * a fold that runs in one place is a fold that can be tested without a corpus.
 *
 * `pg_trgm` is optional. When the extension is absent the engine answers on
 * full text alone — a missing index is a slower query, never an outage — which
 * is what keeps "the application must not fail" true on a database nobody has
 * migrated yet.
 */
@Injectable()
export class LocalKnowledgeSearch implements KnowledgeSearch {
  readonly mode = "local" as const;

  private readonly logger = new Logger(LocalKnowledgeSearch.name);
  private readonly minSimilarity: number;

  /** Null until the first query says whether the extension is installed. */
  private trigram: boolean | null = null;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.minSimilarity =
      config.get<number>("SEARCH_MIN_TRGM") ?? DEFAULT_MIN_SIMILARITY;
  }

  async search(scope: SearchScope, question: string): Promise<SearchResult> {
    const query = normalize(question);

    // Nothing to match on: a greeting, an emoji, or a question made entirely of
    // words that carry no subject. Answering it from the corpus would be a
    // guess, so the caller's no-context path runs instead.
    if (query.terms.length === 0) return { chunks: [], embedTokens: 0 };

    const rows = await this.rowsFor(scope, query);
    if (rows.length === 0) return { chunks: [], embedTokens: 0 };

    const hits: LocalHit[] = rows.map((row) => ({
      chunk: {
        id: row.id,
        text: row.text,
        sourceId: row.source_id,
        title: row.title,
        mime: row.mime ?? null,
        // Replaced by `selectRelevant` with the confidence it computes.
        score: 0,
        page: row.page ?? null,
        sheet: row.sheet ?? null,
        rowFrom: row.row_from ?? null,
        rowTo: row.row_to ?? null,
        heading: row.heading ?? null,
      },
      allTerms: row.all_terms === true,
      someTerms: row.some_terms === true,
      rank: Number(row.rank) || 0,
      similarity: Number(row.similarity) || 0,
    }));

    return { chunks: selectRelevant(hits, this.minSimilarity), embedTokens: 0 };
  }

  /**
   * The rows, from whichever statement this deployment can run.
   *
   * The extension check is a failed query rather than a catalogue read: it is
   * the same round trip as the search itself, and it cannot disagree with the
   * privileges the search actually has. It is paid once per process.
   */
  private async rowsFor(
    scope: SearchScope,
    query: Normalized,
  ): Promise<Row[]> {
    if (this.trigram === false) return this.fullTextOnly(scope, query);

    try {
      const rows = await this.withTrigram(scope, query);
      this.trigram = true;
      return rows;
    } catch (error) {
      if (!missingTrigram(error)) throw error;

      this.trigram = false;
      this.logger.warn(
        "pg_trgm is not installed, so knowledge search is running on full text alone. Install the extension to match spelling variants.",
      );

      return this.fullTextOnly(scope, query);
    }
  }

  /**
   * The two statements are written out twice rather than assembled from a
   * string: Prisma parameterises values, not SQL, and the trigram branch has to
   * be able to disappear at runtime without a query built by concatenation.
   *
   * The workspace is part of the predicate, not an inference from the agent id.
   */
  private withTrigram(scope: SearchScope, query: Normalized): Promise<Row[]> {
    return this.prisma.$queryRaw<Row[]>`
      SELECT c.id, c.text, s.id AS source_id, s.title, s.mime,
             c.page, c.sheet, c.row_from, c.row_to, c.heading,
             ts_rank_cd(to_tsvector('english', c.text),
                        websearch_to_tsquery('english', ${query.anyOf})) AS rank,
             word_similarity(${query.text}, c.text) AS similarity,
             to_tsvector('english', c.text)
               @@ websearch_to_tsquery('english', ${query.anyOf}) AS some_terms,
             to_tsvector('english', c.text)
               @@ websearch_to_tsquery('english', ${query.text}) AS all_terms
      FROM knowledge_chunks c
      JOIN knowledge_sources s ON s.id = c.source_id
      JOIN agents a ON a.id = s.agent_id
      WHERE s.agent_id = ${scope.agentId}::uuid
        AND a.workspace_id = ${scope.workspaceId}::uuid
        AND s.status = 'READY'
        AND (
          to_tsvector('english', c.text)
            @@ websearch_to_tsquery('english', ${query.anyOf})
          OR word_similarity(${query.text}, c.text) >= ${this.minSimilarity}
        )
      ORDER BY all_terms DESC, some_terms DESC, rank DESC, similarity DESC
      LIMIT ${CANDIDATES}
    `;
  }

  private fullTextOnly(
    scope: SearchScope,
    query: Normalized,
  ): Promise<Row[]> {
    return this.prisma.$queryRaw<Row[]>`
      SELECT c.id, c.text, s.id AS source_id, s.title, s.mime,
             c.page, c.sheet, c.row_from, c.row_to, c.heading,
             ts_rank_cd(to_tsvector('english', c.text),
                        websearch_to_tsquery('english', ${query.anyOf})) AS rank,
             0::float8 AS similarity,
             to_tsvector('english', c.text)
               @@ websearch_to_tsquery('english', ${query.anyOf}) AS some_terms,
             to_tsvector('english', c.text)
               @@ websearch_to_tsquery('english', ${query.text}) AS all_terms
      FROM knowledge_chunks c
      JOIN knowledge_sources s ON s.id = c.source_id
      JOIN agents a ON a.id = s.agent_id
      WHERE s.agent_id = ${scope.agentId}::uuid
        AND a.workspace_id = ${scope.workspaceId}::uuid
        AND s.status = 'READY'
        AND to_tsvector('english', c.text)
              @@ websearch_to_tsquery('english', ${query.anyOf})
      ORDER BY all_terms DESC, some_terms DESC, rank DESC
      LIMIT ${CANDIDATES}
    `;
  }
}

/**
 * Postgres says `function word_similarity(text, text) does not exist` when the
 * extension was never created. Anything else is a real failure and belongs to
 * the caller.
 */
function missingTrigram(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  if (!message.includes("does not exist")) return false;

  return message.includes("word_similarity") || message.includes("similarity");
}
