import { randomUUID } from "node:crypto";

import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";

import type { AuthClaims } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import type { UploadedMedia } from "../inbox/inbox.sender";
import { MediaStorage } from "../inbox/media.storage";
import { AiError, ExtractError } from "./ai.errors";
import { OpenAiProvider, toVector } from "./ai.openai";
import { extractDocument, extensionOf } from "./extract";
import { OpenAiMediaExtractor, resolveMime } from "./extract.media";
import {
  MAX_CHUNKS,
  estimateTokens,
  splitText,
} from "./knowledge.chunk";
import type { AddTextSourceDto } from "./dto/add-text-source.dto";

/** The same ceiling the inbox uses for what leaves, applied to what arrives. */
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

/** Chunks per embedding call. Verified: one call returns many vectors. */
const EMBED_BATCH = 32;

/** A row stuck in PROCESSING for this long belongs to a process that died. */
const STALE_MS = 10 * 60 * 1000;

/** Automatic attempts before a source is left FAILED for a human to retry. */
const MAX_ATTEMPTS = 2;

export interface SourceView {
  id: string;
  kind: "TEXT" | "FILE";
  title: string;
  mime: string | null;
  size: number | null;
  status: "PENDING" | "PROCESSING" | "READY" | "FAILED";
  error: string | null;
  charCount: number;
  chunkCount: number;
  embedTokens: number;
  indexedAt: string | null;
  createdAt: string;
}

/**
 * The knowledge base: where a file becomes a row of vectors.
 *
 * Uploads write the bytes and a PENDING row in the request; the work happens in
 * `AgentsRunner`, because a 1,200-chunk price book is forty embedding calls and
 * no HTTP request should own that. Extraction is additive — the text is kept on
 * the source so re-embedding never asks for the file again.
 */
@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly storage: MediaStorage,
    private readonly provider: OpenAiProvider,
    private readonly media: OpenAiMediaExtractor,
  ) {}

  async addText(
    claims: AuthClaims,
    agentId: string,
    dto: AddTextSourceDto,
  ): Promise<{ source: SourceView }> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);
    const agent = await this.agentOf(workspaceId, agentId);

    const row = await this.prisma.knowledgeSource.create({
      data: {
        agentId: agent.id,
        kind: "TEXT",
        title: dto.title,
        text: dto.body,
        charCount: dto.body.length,
        status: "PENDING",
      },
    });

    return { source: sourceView(row) };
  }

  async addFile(
    claims: AuthClaims,
    agentId: string,
    file: UploadedMedia,
  ): Promise<{ source: SourceView }> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);
    const agent = await this.agentOf(workspaceId, agentId);

    if (file.size > MAX_SOURCE_BYTES) {
      throw new ConflictException({
        code: "SOURCE_TOO_LARGE",
        message: "Training files are limited to 25 MB.",
      });
    }

    // The id is chosen here so the storage path can be written before the row:
    // an upload that lands without a row is garbage, and a row without an
    // upload is a retry that can never work.
    const id = randomUUID();
    const path = `agents/${workspaceId}/${agentId}/${id}.${extensionOf(file.originalname) || "bin"}`;

    await this.storage.upload(path, file.buffer, file.mimetype || "application/octet-stream");

    try {
      const row = await this.prisma.knowledgeSource.create({
        data: {
          id,
          agentId: agent.id,
          kind: "FILE",
          title: file.originalname || "Untitled file",
          mime: file.mimetype || null,
          size: file.size,
          storagePath: path,
          status: "PENDING",
        },
      });

      return { source: sourceView(row) };
    } catch (error) {
      // No row will ever name these bytes, so they must not stay billed.
      await this.storage.remove([path]);
      throw error;
    }
  }

  async list(claims: AuthClaims, agentId: string): Promise<{ sources: SourceView[] }> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);
    const agent = await this.agentOf(workspaceId, agentId);

    const rows = await this.prisma.knowledgeSource.findMany({
      where: { agentId: agent.id },
      orderBy: { createdAt: "desc" },
    });

    return { sources: rows.map(sourceView) };
  }

  async remove(
    claims: AuthClaims,
    agentId: string,
    sourceId: string,
  ): Promise<{ deleted: true }> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);
    const agent = await this.agentOf(workspaceId, agentId);
    const source = await this.sourceOf(agent.id, sourceId);

    // Chunks go with the row (cascade). The stored original has no foreign key.
    await this.prisma.knowledgeSource.delete({ where: { id: source.id } });

    if (source.storagePath) await this.storage.remove([source.storagePath]);

    return { deleted: true };
  }

  async retry(
    claims: AuthClaims,
    agentId: string,
    sourceId: string,
  ): Promise<{ source: SourceView }> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);
    const agent = await this.agentOf(workspaceId, agentId);
    const source = await this.sourceOf(agent.id, sourceId);

    const row = await this.prisma.knowledgeSource.update({
      where: { id: source.id },
      data: {
        status: "PENDING",
        error: null,
        attempts: 0,
        // A file is re-read from storage; a typed note keeps its text.
        ...(source.kind === "FILE" ? { text: null } : {}),
      },
    });

    return { source: sourceView(row) };
  }

  /** The workspace's agent, or a 404 that another tenant's id also gets. */
  async agentOf(workspaceId: string, agentId: string) {
    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId, workspaceId },
      select: {
        id: true,
        workspaceId: true,
        name: true,
        description: true,
        model: true,
        isActive: true,
        whatsappAccountId: true,
      },
    });

    if (!agent) throw new NotFoundException("That agent does not exist.");

    return agent;
  }

  private async sourceOf(agentId: string, sourceId: string) {
    const source = await this.prisma.knowledgeSource.findFirst({
      where: { id: sourceId, agentId },
      select: { id: true, kind: true, storagePath: true },
    });

    if (!source) throw new NotFoundException("That source does not exist.");

    return source;
  }

  /**
   * Claim one pending source. The statement is the lock: two runners waking at
   * the same instant cannot both take it, and `SKIP LOCKED` keeps the second
   * from waiting on the first.
   */
  async claim(): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE knowledge_sources
      SET status = 'PROCESSING', updated_at = now()
      WHERE id = (
        SELECT id FROM knowledge_sources
        WHERE status = 'PENDING'
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id
    `;

    return rows[0]?.id ?? null;
  }

  /**
   * Extract, split, embed, mark READY. Never throws: a runner tick that dies
   * here would stop every other source behind it.
   */
  async index(sourceId: string): Promise<void> {
    const source = await this.loadForIndex(sourceId);

    if (!source || source.status !== "PROCESSING") return;

    try {
      const text =
        source.text && source.text.length > 0
          ? source.text
          : await this.readSource(source);

      const chunks = splitText(text);

      if (chunks.length === 0) {
        throw new ExtractError("SOURCE_EMPTY", "There was no readable text in that source.");
      }

      if (chunks.length > MAX_CHUNKS) {
        throw new ExtractError(
          "SOURCE_TOO_LARGE",
          `That document splits into ${chunks.length} chunks, over the ${MAX_CHUNKS} limit. Split it or upload the part that matters.`,
        );
      }

      // A retry re-reads from storage; the old chunks must not outlive it.
      await this.prisma.knowledgeChunk.deleteMany({ where: { sourceId: source.id } });

      await this.prisma.knowledgeChunk.createMany({
        data: chunks.map((chunk, ord) => ({
          sourceId: source.id,
          ord,
          text: chunk,
          tokens: estimateTokens(chunk),
        })),
      });

      const rows = await this.prisma.knowledgeChunk.findMany({
        where: { sourceId: source.id },
        orderBy: { ord: "asc" },
        select: { id: true, text: true },
      });

      let embedTokens = 0;

      for (let at = 0; at < rows.length; at += EMBED_BATCH) {
        const batch = rows.slice(at, at + EMBED_BATCH);
        const embedded = await this.provider.embed(batch.map((row) => row.text));

        embedTokens += embedded.tokens;

        await this.prisma.$transaction(
          batch.map((row, index) =>
            this.prisma.$executeRaw`
              UPDATE knowledge_chunks
              SET embedding = ${toVector(embedded.vectors[index])}::vector
              WHERE id = ${row.id}::uuid
            `,
          ),
        );

        // Renew the lease: `recoverStale` measures a live job by `updatedAt`,
        // and a long document is several minutes of paid calls. Without this a
        // busy source looks like a dead process and is handed to a second
        // worker, which pays for the same embeddings twice.
        await this.prisma.knowledgeSource.updateMany({
          where: { id: source.id, status: "PROCESSING" },
          data: { updatedAt: new Date() },
        });
      }

      // Conditional on still owning the row: if ownership was lost mid-job the
      // newer attempt's status is the truth, and this one must not overwrite it.
      const finished = await this.prisma.knowledgeSource.updateMany({
        where: { id: source.id, status: "PROCESSING" },
        data: {
          text,
          charCount: text.length,
          chunkCount: rows.length,
          embedTokens,
          status: "READY",
          error: null,
          indexedAt: new Date(),
        },
      });

      if (finished.count > 0) {
        this.logger.log(
          `Indexed ${rows.length} chunks for source ${source.id} (${source.title}).`,
        );
      }
    } catch (error) {
      await this.fail(source.id, error);
    }
  }

  /**
   * The lookup is a database call like any other. If it rejects, the source is
   * recorded as failed rather than escaping a method that promised not to
   * throw and leaving a claimed row stranded in PROCESSING.
   */
  private async loadForIndex(sourceId: string) {
    try {
      return await this.prisma.knowledgeSource.findUnique({
        where: { id: sourceId },
        select: {
          id: true,
          kind: true,
          title: true,
          mime: true,
          storagePath: true,
          text: true,
          status: true,
          agent: { select: { model: true } },
        },
      });
    } catch (error) {
      await this.fail(sourceId, error);
      return null;
    }
  }

  private async readSource(source: {
    id: string;
    kind: "TEXT" | "FILE";
    title: string;
    mime: string | null;
    storagePath: string | null;
    agent: { model: string };
  }): Promise<string> {
    if (source.kind === "TEXT") {
      throw new ExtractError("SOURCE_EMPTY", "That note had no text.");
    }

    if (!source.storagePath) {
      throw new ExtractError(
        "SOURCE_EMPTY",
        "This source has no stored file to read. Upload it again.",
      );
    }

    const bytes = await this.storage.download(source.storagePath);
    const mime = resolveMime(source.mime, source.title);

    if (mime.startsWith("image/") || mime.startsWith("audio/") || mime.startsWith("video/")) {
      return (await this.media.read({
        bytes,
        mime,
        name: source.title,
        model: source.agent.model,
      })).text;
    }

    return extractDocument({ bytes, mime, name: source.title });
  }

  /**
   * A failed source keeps its reason and loses its chunks: a half-indexed file
   * that answers is worse than one that says it could not be read.
   */
  private async fail(sourceId: string, error: unknown): Promise<void> {
    const message =
      error instanceof ExtractError || error instanceof AiError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Extraction failed.";

    this.logger.warn(`Source ${sourceId} failed: ${message}`);

    // One transaction: a row marked FAILED with its chunks still attached would
    // answer from a half-read file. If the cleanup itself cannot be written,
    // the row stays PROCESSING and stale recovery hands it another attempt.
    await this.prisma
      .$transaction([
        this.prisma.knowledgeChunk.deleteMany({ where: { sourceId } }),
        this.prisma.knowledgeSource.update({
          where: { id: sourceId },
          data: { status: "FAILED", error: message, chunkCount: 0 },
        }),
      ])
      .catch((failure: unknown) => {
        this.logger.warn(
          `Could not record the failure for source ${sourceId}: ${failure instanceof Error ? failure.message : "unknown error"}`,
        );
      });
  }

  /**
   * Return rows whose process died. Measured on `updatedAt`, so no second
   * timestamp column is needed; the capped ones are left FAILED rather than
   * looped forever.
   */
  async recoverStale(): Promise<void> {
    const cut = new Date(Date.now() - STALE_MS);

    // A row that has spent its attempts is finished with, and its chunks must
    // go with it — the failed branch of `fail`, for a process that died before
    // it could run.
    const spent = await this.prisma.knowledgeSource.findMany({
      where: {
        status: "PROCESSING",
        updatedAt: { lt: cut },
        attempts: { gte: MAX_ATTEMPTS - 1 },
      },
      select: { id: true },
    });

    if (spent.length > 0) {
      const ids = spent.map((row) => row.id);

      // Both writes or neither: a row left FAILED with its chunks attached is
      // the half-read file this branch exists to prevent. Within the
      // transaction the delete sees the FAILED written just before it, so the
      // relation filter also protects a row a live runner turned READY.
      await this.prisma.$transaction([
        this.prisma.knowledgeSource.updateMany({
          where: { id: { in: ids }, status: "PROCESSING", updatedAt: { lt: cut } },
          data: {
            status: "FAILED",
            error: "Indexing was interrupted repeatedly and will not be retried automatically. Use Retry.",
            chunkCount: 0,
          },
        }),
        this.prisma.knowledgeChunk.deleteMany({
          where: { sourceId: { in: ids }, source: { status: "FAILED" } },
        }),
      ]);
    }

    await this.prisma.knowledgeSource.updateMany({
      where: { status: "PROCESSING", updatedAt: { lt: cut } },
      data: { status: "PENDING", attempts: { increment: 1 } },
    });
  }
}

export function sourceView(row: {
  id: string;
  kind: "TEXT" | "FILE";
  title: string;
  mime: string | null;
  size: number | null;
  status: "PENDING" | "PROCESSING" | "READY" | "FAILED";
  error: string | null;
  charCount: number;
  chunkCount: number;
  embedTokens: number;
  indexedAt: Date | null;
  createdAt: Date;
}): SourceView {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    mime: row.mime,
    size: row.size,
    status: row.status,
    error: row.error,
    charCount: row.charCount,
    chunkCount: row.chunkCount,
    embedTokens: row.embedTokens,
    indexedAt: row.indexedAt ? row.indexedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}
