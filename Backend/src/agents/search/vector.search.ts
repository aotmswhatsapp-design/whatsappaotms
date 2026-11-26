import { Injectable, Logger } from "@nestjs/common";

import { PrismaService } from "../../prisma/prisma.service";
import { OpenAiProvider, toVector } from "../ai.openai";
import type { ContextChunk } from "./context-chunk";
import { FLOOR, RETRY_K, rank } from "./vector.rank";
import type { KnowledgeSearch, SearchResult, SearchScope } from "./search.port";

interface Row {
  id: string;
  text: string;
  source_id: string;
  title: string;
  mime: string | null;
  score: number;
  page: number | null;
  sheet: string | null;
  row_from: number | null;
  row_to: number | null;
  heading: string | null;
}

/**
 * Cosine search over one agent's READY chunks.
 *
 * The original engine, kept for a deployment that has already paid for its
 * embeddings. It is the only one of the two that needs `OPENAI_API_KEY`, which
 * is exactly why it is no longer the default.
 *
 * `iterative_scan` is why pgvector 0.8 matters: the filter is applied after the
 * index scan, so without it a busy table returns fewer than six rows whenever
 * other agents' chunks crowd the neighbourhood. On a multi-tenant install that
 * is a correctness bug, not a tuning knob.
 */
@Injectable()
export class VectorKnowledgeSearch implements KnowledgeSearch {
  readonly mode = "vector" as const;

  private readonly logger = new Logger(VectorKnowledgeSearch.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: OpenAiProvider,
  ) {}

  async search(scope: SearchScope, question: string): Promise<SearchResult> {
    const { vectors, tokens } = await this.provider.embed([question]);
    const vector = toVector(vectors[0]);

    // `SET LOCAL` only applies inside a transaction, and both statements have
    // to share one connection. The array form is one connection and one
    // transaction — unlike the interactive form this codebase avoids on the
    // Supabase pooler.
    //
    // The limit is the wider one because the choice between the two floors
    // happens after the rows are read: a query that is refused at `FLOOR`
    // needs rows 7–12 to exist before `rank` can look at them.
    const [, rows] = await this.prisma.$transaction([
      this.prisma.$executeRawUnsafe(
        "SET LOCAL hnsw.iterative_scan = relaxed_order",
      ),
      this.prisma.$queryRaw<Row[]>`
        SELECT c.id, c.text, s.id AS source_id, s.title, s.mime,
               c.page, c.sheet, c.row_from, c.row_to, c.heading,
               1 - (c.embedding <=> ${vector}::vector) AS score
        FROM knowledge_chunks c
        JOIN knowledge_sources s ON s.id = c.source_id
        JOIN agents a ON a.id = s.agent_id
        WHERE s.agent_id = ${scope.agentId}::uuid
          AND a.workspace_id = ${scope.workspaceId}::uuid
          AND s.status = 'READY'
          AND c.embedding IS NOT NULL
        ORDER BY c.embedding <=> ${vector}::vector
        LIMIT ${RETRY_K}
      `,
    ]);

    const ranked = rows.map((row) => ({
      id: row.id,
      text: row.text,
      sourceId: row.source_id,
      title: row.title,
      mime: row.mime ?? null,
      score: Number(row.score),
      page: row.page ?? null,
      sheet: row.sheet ?? null,
      rowFrom: row.row_from ?? null,
      rowTo: row.row_to ?? null,
      heading: row.heading ?? null,
    }));

    const chunks: ContextChunk[] = rank(ranked);

    // The relaxed pass is the only behaviour that changed, so it is the only
    // one worth a line: the score says whether `RETRY_FLOOR` is earning its
    // place or letting noise through. The question itself is not logged.
    if (chunks.length > 0 && chunks[0].score < FLOOR) {
      this.logger.debug(
        `Relaxed retrieval for agent ${scope.agentId}: ` +
          `${chunks.length} chunk(s) below the strict floor, ` +
          `top ${chunks[0].score.toFixed(3)}`,
      );
    }

    return { chunks, embedTokens: tokens };
  }
}
