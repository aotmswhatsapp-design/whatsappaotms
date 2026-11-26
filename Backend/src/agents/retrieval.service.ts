import { Injectable } from "@nestjs/common";

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

export interface ContextChunk {
  id: string;
  text: string;
  sourceId: string;
  title: string;
  /** Cosine similarity, 0 to 1. */
  score: number;
  /** 1-based PDF page, when the extractor recorded one. */
  page: number | null;
  /** CSV/XLSX sheet name, when the chunk came from a table. */
  sheet: string | null;
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
 * `iterative_scan` is why pgvector 0.8 matters: the filter is applied after the
 * index scan, so without it a busy table returns fewer than six rows whenever
 * other agents' chunks crowd the neighbourhood. On a multi-tenant install that
 * is a correctness bug, not a tuning knob.
 */
@Injectable()
export class RetrievalService {
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
    const [, rows] = await this.prisma.$transaction([
      this.prisma.$executeRawUnsafe(
        "SET LOCAL hnsw.iterative_scan = relaxed_order",
      ),
      this.prisma.$queryRaw<Row[]>`
        SELECT c.id, c.text, s.id AS source_id, s.title,
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
        LIMIT ${TOP_K}
      `,
    ]);

    const chunks = rows
      .map((row) => ({
        id: row.id,
        text: row.text,
        sourceId: row.source_id,
        title: row.title,
        score: Number(row.score),
        page: row.page ?? null,
        sheet: row.sheet ?? null,
        rowFrom: row.row_from ?? null,
        rowTo: row.row_to ?? null,
        heading: row.heading ?? null,
      }))
      .filter((row) => row.score >= FLOOR);

    return { chunks, embedTokens: tokens };
  }
}
