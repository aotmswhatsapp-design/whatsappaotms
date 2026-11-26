import { Injectable, Logger } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";
import { OpenAiProvider, toVector } from "./ai.openai";

/** How many chunks the prompt can carry before it stops being one answer. */
export const TOP_K = 6;

/**
 * Below this a match is noise. It is deliberately low: a fixed threshold is
 * model- and corpus-dependent, and a high one would silently refuse questions
 * the material does answer. The floor only drops near-zero matches.
 */
export const FLOOR = 0.25;

/**
 * The second, wider look, taken only when the strict one found nothing.
 *
 * A one- or two-word question — "price", "delivery" — embeds close to the
 * middle of the corpus, so the chunk that does answer it can be the nearest
 * neighbour and still score under `FLOOR`. Reading more rows costs one wider
 * index scan. It is the threshold, not the limit, that was discarding the
 * answer: raising the limit alone would have returned more rows under the
 * same floor and still filtered them all away.
 */
export const RETRY_K = 12;

/**
 * Low enough to keep a short query's real match, high enough to drop noise:
 * unrelated text sits around 0.0–0.1 with this model, so 0.15 is a floor for
 * "perhaps relevant" rather than a claim of a good match.
 */
export const RETRY_FLOOR = 0.15;

export interface ContextChunk {
  id: string;
  text: string;
  sourceId: string;
  title: string;
  /** What the upload proved the file is (see `knowledge.file.ts`). A citation
   *  decides "CSV" by this, never by the sheet name: a workbook can hold a
   *  worksheet called "CSV". */
  mime: string | null;
  /** Cosine similarity, 0 to 1. */
  score: number;
  /** 1-based PDF page, when the extractor recorded one. */
  page: number | null;
  /** CSV/XLSX sheet name, when the chunk came from a table. */
  sheet: string | null;
  /** First and last row this chunk covers, in the file's own numbering: a
   *  physical worksheet row for XLSX, a logical record number for CSV (blank
   *  records count, the header does not). Null when the chunk is not tabular. */
  rowFrom: number | null;
  rowTo: number | null;
  /** Nearest preceding heading (DOCX, Markdown). */
  heading: string | null;
}

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
 * Which rows reach the prompt, as one pure decision so the bounds can be tested
 * without a database.
 *
 * The two passes are ordered, not blended: when anything clears `FLOOR` the
 * strict result is returned untouched, and the wider threshold is consulted
 * only when it would otherwise be empty. That makes the change monotone — no
 * question that answers today is handed different material — and it confines
 * the weaker chunks to the questions that used to be refused before the model
 * ever saw them.
 */
export function rank(rows: ContextChunk[]): ContextChunk[] {
  const strict = rows.filter((row) => row.score >= FLOOR).slice(0, TOP_K);
  if (strict.length > 0) return strict;

  return rows
    .filter((row) => row.score >= RETRY_FLOOR)
    .sort((a, b) => b.score - a.score)
    .slice(0, RETRY_K);
}

/**
 * Cosine search over one agent's READY chunks.
 *
 * `iterative_scan` is why pgvector 0.8 matters: the filter is applied after the
 * index scan, so without it a busy table returns fewer than six rows whenever
 * other agents' chunks crowd the neighbourhood. On a multi-tenant install that
 * is a correctness bug, not a tuning knob.
 */
@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: OpenAiProvider,
  ) {}

  /**
   * The workspace is part of the predicate, not an inference from the agent id.
   * A source row whose agent was moved between tenants must not answer here.
   */
  async search(
    scope: { agentId: string; workspaceId: string },
    question: string,
  ): Promise<{ chunks: ContextChunk[]; embedTokens: number }> {
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

    const chunks = rank(ranked);

    // The relaxed pass is the only behaviour that changed, so it is the only
    // one worth a line: the score says whether `RETRY_FLOOR` is earning its
    // place or letting noise through. The question itself is not logged.
    if (chunks.length > 0 && chunks[0].score < FLOOR) {
      this.logger.debug(
        `Relaxed retrieval for agent ${scope.agentId}: ` +
          `${chunks.length} chunk(s) at or above ${RETRY_FLOOR}, ` +
          `top ${chunks[0].score.toFixed(3)}`,
      );
    }

    return { chunks, embedTokens: tokens };
  }
}
