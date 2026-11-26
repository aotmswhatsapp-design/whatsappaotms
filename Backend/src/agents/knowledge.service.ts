import { randomUUID } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, type KnowledgeSource } from "@prisma/client";

import type { AuthClaims } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import type { UploadedMedia } from "../inbox/inbox.sender";
import { MediaStorage } from "../inbox/media.storage";
import { AiError, ExtractError } from "./ai.errors";
import { OpenAiProvider, toVector } from "./ai.openai";
import { extractSource, type Extracted, type ExtractedMeta } from "./extract";
import { OpenAiMediaExtractor, resolveMime } from "./extract.media";
import { probeImage } from "./image.probe";
import { MAX_SOURCE_BYTES, inspectUpload, type InspectedFile } from "./knowledge.file";
import {
  MAX_CHUNKS,
  chunkBlocks,
  estimateTokens,
} from "./knowledge.chunk";
import type { AddTextSourceDto } from "./dto/add-text-source.dto";

export { MAX_SOURCE_BYTES } from "./knowledge.file";

/** Chunks per embedding call. Verified: one call returns many vectors. */
const EMBED_BATCH = 32;

/** A row stuck in PROCESSING for this long belongs to a process that died. */
export const STALE_MS = 10 * 60 * 1000;

/**
 * A live job renews its lease this often.
 *
 * Three renewals fit inside the stale cut, so a worker that dies is still
 * recovered while a worker that is merely slow is not: the job budget and the
 * stale cut stopped being the same clock once the lease renews itself (B-16).
 */
export const LEASE_RENEW_MS = 2 * 60 * 1000;

/**
 * The age at which a PROCESSING row may be given to another worker.
 *
 * The floor recovers a dead worker quickly; the budget term is what makes the
 * pair consistent. A job is allowed to run for its whole budget, so the reaper
 * must not take the claim before then — plus two renewals of slack for the
 * heartbeat in flight. An 8-minute budget under a 10-minute cut is exactly the
 * row two workers index at once (B-16).
 */
export function staleCutMs(budgetMs: number): number {
  return Math.max(STALE_MS, budgetMs + LEASE_RENEW_MS * 2);
}

/** Automatic attempts before a source is left FAILED for a human to retry. */
const MAX_ATTEMPTS = 2;

/**
 * Every transaction whose correctness depends on what a competitor sees.
 *
 * `ReadCommitted` is explicit because the successor count in `claimAndCreate`
 * must observe another request's committed row; a snapshot taken before the
 * lock wait (repeatable read) would let two replacements pass. The timeouts turn
 * a contended lock into a 409 instead of a P2028 at the default five seconds.
 */
const TX = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  maxWait: 5_000,
  timeout: 10_000,
};

/** The shape a row records for its source; `ExtractedMeta` owns the variants. */
export type SourceMeta = ExtractedMeta;

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
  extractTokens: number;
  indexedAt: string | null;
  createdAt: string;
  meta: SourceMeta | null;
  replacesSourceId: string | null;
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
    config: ConfigService,
  ) {
    // The interceptor cannot read configuration (decorators run before DI), so
    // 25 MB is its hard ceiling and this may only lower it.
    this.maxBytes = Math.min(
      config.get<number>("KNOWLEDGE_MAX_BYTES") ?? MAX_SOURCE_BYTES,
      MAX_SOURCE_BYTES,
    );

    // A job that outlives this is stopped at the next batch boundary: the row
    // ends FAILED with a sentence instead of holding its claim for ever.
    this.jobBudgetMs =
      config.get<number>("KNOWLEDGE_JOB_BUDGET_MS") ?? 8 * 60 * 1000;

    // Derived, never configured separately: the reaper's cut follows whatever
    // budget is set, so no combination of settings can expire a live claim.
    this.staleMs = staleCutMs(this.jobBudgetMs);
  }

  private readonly maxBytes: number;
  private readonly jobBudgetMs: number;
  private readonly staleMs: number;

  async addText(
    claims: AuthClaims,
    agentId: string,
    dto: AddTextSourceDto,
  ): Promise<{ source: SourceView }> {
    const { workspaceId, userId } = await this.workspaces.primaryFor(claims);
    const agent = await this.agentOf(workspaceId, agentId);

    const row = await this.prisma.knowledgeSource.create({
      data: {
        agentId: agent.id,
        kind: "TEXT",
        title: dto.title,
        text: dto.body,
        charCount: dto.body.length,
        uploadedByUserId: userId,
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
    const { workspaceId, userId } = await this.workspaces.primaryFor(claims);
    const agent = await this.agentOf(workspaceId, agentId);

    const inspected = this.admit(file);
    const id = randomUUID();

    return this.store({
      agentId: agent.id,
      workspaceId,
      userId,
      id,
      inspected,
      bytes: file.buffer,
      replacesSourceId: null,
    });
  }

  /**
   * `inspectUpload` refuses in the vocabulary of a job, where a sentence is all
   * a caller needs. In the request the same refusal is the client's mistake, so
   * it must be a 4xx rather than a 500 that blames this process.
   */
  private admit(file: UploadedMedia): InspectedFile {
    try {
      return inspectUpload({
        name: file.originalname,
        declaredMime: file.mimetype ?? "",
        bytes: file.buffer,
        limit: this.maxBytes,
      });
    } catch (error) {
      if (!(error instanceof ExtractError)) throw error;

      const body = { code: error.code, message: error.message };

      // 413, not 409: the interceptor's own ceiling already answers 413, and one
      // limit must not have two statuses.
      if (error.code === "SOURCE_TOO_LARGE") throw new PayloadTooLargeException(body);
      if (error.code === "SOURCE_EMPTY") throw new BadRequestException(body);

      throw new UnsupportedMediaTypeException(body);
    }
  }

  /**
   * Bytes first, row second, and the object removed if the row cannot be written:
   * an object with no row is garbage, and a row without an object is a retry that
   * can never succeed.
   *
   * Shared with `replace`, which is the same operation with one extra column.
   *
   * `id` must be a freshly generated UUID on every call, and must never be the id
   * of the source being replaced. The object key is built from it, so a reused id
   * would overwrite the incumbent's bytes, and the P2002 cleanup below would then
   * delete an object a live row still points at.
   */
  private async store(input: {
    agentId: string;
    workspaceId: string;
    userId: string;
    id: string;
    inspected: InspectedFile;
    bytes: Buffer;
    replacesSourceId: string | null;
  }): Promise<{ source: SourceView }> {
    const duplicate = await this.prisma.knowledgeSource.findFirst({
      where: {
        agentId: input.agentId,
        sha256: input.inspected.sha256,
        id: input.replacesSourceId ? { not: input.replacesSourceId } : undefined,
      },
      select: { id: true, title: true },
    });

    if (duplicate) {
      throw new ConflictException({
        code: "SOURCE_DUPLICATE",
        message: `That file is already attached as “${duplicate.title}”. Delete it there before uploading it again.`,
      });
    }

    const path = `workspaces/${input.workspaceId}/agents/${input.agentId}/knowledge/${input.id}/original.${input.inspected.extension}`;

    // An image's row should say what the picture is before anyone reads it. The
    // probe answers from the bytes; when it cannot, the sniffed type is still
    // right and the size stays unknown rather than refused.
    const meta =
      input.inspected.kind === "image"
        ? {
            kind: "image" as const,
            ...(probeImage(input.bytes) ?? {
              mime: input.inspected.mime,
              width: null,
              height: null,
            }),
          }
        : undefined;

    const data: Prisma.KnowledgeSourceUncheckedCreateInput = {
      id: input.id,
      agentId: input.agentId,
      kind: "FILE",
      title: input.inspected.title,
      mime: input.inspected.mime,
      size: input.bytes.length,
      storagePath: path,
      sha256: input.inspected.sha256,
      uploadedByUserId: input.userId,
      replacesSourceId: input.replacesSourceId,
      meta,
      status: "PENDING",
    };

    await this.storage.upload(path, input.bytes, input.inspected.mime);

    try {
      const row =
        input.replacesSourceId === null
          ? await this.prisma.knowledgeSource.create({ data })
          : await this.claimAndCreate(input.replacesSourceId, data);

      return { source: sourceView(row) };
    } catch (error) {
      // A transaction can commit and still reject: the acknowledgement is lost,
      // the connection drops at COMMIT, the pool recycles. The row is the truth.
      // If this attempt's row exists, its object is the one the row names, so
      // deleting it would break a live source; the upload succeeded.
      const written = await this.findJustWritten(input.id);

      if (written === "unknown") throw error;
      if (written) return { source: sourceView(written) };

      await this.storage.remove([path]);

      // The unique index is the race backstop: two identical uploads at once.
      if (isUniqueViolation(error)) {
        throw new ConflictException({
          code: "SOURCE_DUPLICATE",
          message: "That file is already attached to this agent.",
        });
      }

      // A deadlock victim or a transaction that outlived its timeout is
      // retryable, not a bug in this process.
      if (prismaCodeOf(error) === "P2034") {
        throw new ConflictException({
          code: "SOURCE_BUSY",
          message: "Another replacement of that source is in progress. Try again.",
        });
      }

      if (prismaCodeOf(error) === "P2028") {
        throw new ServiceUnavailableException(
          "The upload could not be stored before its transaction expired. Try again.",
        );
      }

      throw error;
    }
  }

  /**
   * The row this attempt wrote, if the write landed despite the error.
   *
   * `"unknown"` means the database could not answer. Keeping the object wastes
   * bytes the sweeper reclaims; deleting it could break a row that does exist,
   * so the doubt resolves towards keeping.
   */
  private async findJustWritten(
    id: string,
  ): Promise<KnowledgeSource | null | "unknown"> {
    try {
      return await this.prisma.knowledgeSource.findUnique({ where: { id } });
    } catch (error) {
      this.logger.warn(
        `Could not confirm whether source ${id} was written (${error instanceof Error ? error.message : "unknown error"}); keeping its object.`,
      );
      return "unknown";
    }
  }

  /**
   * Safe replacement.
   *
   * A second row is written and indexed while the old one keeps answering:
   * retrieval only reads `READY` rows, so the old knowledge is available until
   * the new source is proven. The old row is deleted inside the transaction
   * that marks the new one READY, and nowhere else — a replacement that fails
   * leaves the working source exactly as it was.
   */
  async replace(
    claims: AuthClaims,
    agentId: string,
    sourceId: string,
    file: UploadedMedia,
  ): Promise<{ source: SourceView }> {
    const { workspaceId, userId } = await this.workspaces.primaryFor(claims);
    const agent = await this.agentOf(workspaceId, agentId);
    const target = await this.sourceOf(agent.id, sourceId);

    if (target.kind !== "FILE") {
      throw new ConflictException({
        code: "SOURCE_NOT_FILE",
        message: "A typed note is edited, not replaced. Delete it and write the new one.",
      });
    }

    if (target.status === "PENDING" || target.status === "PROCESSING") {
      throw new ConflictException({
        code: "SOURCE_BUSY",
        message: "Wait for the current upload to finish, then replace it.",
      });
    }

    // The same read that refuses a client error with a 4xx, so a replacement
    // that is too large or unreadable fails like an upload, not like a bug.
    const inspected = this.admit(file);

    if (target.sha256 && target.sha256 === inspected.sha256) {
      throw new ConflictException({
        code: "SOURCE_UNCHANGED",
        message: "That is the same file. Upload the new version.",
      });
    }

    return this.store({
      agentId: agent.id,
      workspaceId,
      userId,
      id: randomUUID(),
      inspected,
      bytes: file.buffer,
      replacesSourceId: target.id,
    });
  }

  /**
   * Writes a replacement's row under the replaced source's row lock.
   *
   * The status read in `replace()` is the friendly answer; this is the
   * authority. Two replacements of one source race on the `updateMany` below:
   * the first holds the lock until it commits, and the second then sees the
   * first one's successor and is refused. Only one replacement can succeed, and
   * a refusal rolls back the lock's `updatedAt` bump with the transaction.
   */
  private async claimAndCreate(
    predecessorId: string,
    data: Prisma.KnowledgeSourceUncheckedCreateInput,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.knowledgeSource.updateMany({
        where: { id: predecessorId, agentId: data.agentId },
        data: { updatedAt: new Date() },
      });

      if (locked.count === 0) {
        throw new NotFoundException("That source does not exist.");
      }

      const current = await tx.knowledgeSource.findUnique({
        where: { id: predecessorId },
        select: { status: true, sha256: true },
      });

      if (!current) throw new NotFoundException("That source does not exist.");

      if (current.status === "PENDING" || current.status === "PROCESSING") {
        throw new ConflictException({
          code: "SOURCE_BUSY",
          message: "Wait for the current upload to finish, then replace it.",
        });
      }

      if (current.sha256 && current.sha256 === data.sha256) {
        throw new ConflictException({
          code: "SOURCE_UNCHANGED",
          message: "That is the same file. Upload the new version.",
        });
      }

      const successors = await tx.knowledgeSource.count({
        where: {
          agentId: data.agentId,
          replacesSourceId: predecessorId,
          status: { in: ["PENDING", "PROCESSING", "READY"] },
        },
      });

      if (successors > 0) {
        throw new ConflictException({
          code: "SOURCE_BUSY",
          message: "A replacement for this source is already being prepared.",
        });
      }

      return tx.knowledgeSource.create({ data });
    }, TX);
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

    // A row being read is a running job's subject: deleting it mid-flight would
    // leave the worker writing into a row that no longer exists. Chunks go with
    // the row (cascade); the conditional statement is the authority, because the
    // screen's hidden button is only a hint.
    const deleted = await this.prisma.knowledgeSource.deleteMany({
      where: { id: source.id, agentId: agent.id, status: { not: "PROCESSING" } },
    });

    if (deleted.count === 0) {
      throw new ConflictException({
        code: "SOURCE_BUSY",
        message: "This source is being read right now. Delete it when it finishes.",
      });
    }

    // The stored original has no foreign key, so this is the only place it can
    // be named again; a failed delete is the sweeper's work.
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

    const reset = {
      status: "PENDING" as const,
      error: null,
      attempts: 0,
      // The old counts describe chunks that are about to be deleted.
      charCount: 0,
      chunkCount: 0,
      embedTokens: 0,
      extractTokens: 0,
      // A file is re-read from storage; a typed note keeps its text.
      ...(source.kind === "FILE" ? { text: null } : {}),
    };

    // One lock, two guards. The lock is the one `claimAndCreate` takes, so a
    // replacement cannot be created between the successor check and the reset:
    // a retried predecessor is never the row a READY successor retires. The
    // reset is conditional, not read-then-write: a claim landing between the two
    // would let a second attempt start on a row already being read (B-2).
    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.knowledgeSource.updateMany({
        where: { id: source.id, agentId: agent.id },
        data: { updatedAt: new Date() },
      });

      if (locked.count === 0) {
        throw new NotFoundException("That source does not exist.");
      }

      const successors = await tx.knowledgeSource.count({
        where: {
          agentId: agent.id,
          replacesSourceId: source.id,
          status: { in: ["PENDING", "PROCESSING", "READY"] },
        },
      });

      if (successors > 0) {
        throw new ConflictException({
          code: "SOURCE_BUSY",
          message:
            "This source is being replaced by a newer version. Retry the new version, or delete the old one once it is ready.",
        });
      }

      const updated = await tx.knowledgeSource.updateMany({
        where: {
          id: source.id,
          agentId: agent.id,
          status: { in: ["FAILED", "READY"] },
        },
        data: reset,
      });

      if (updated.count === 0) {
        throw new ConflictException({
          code: "SOURCE_BUSY",
          message:
            "This source is already queued or being read. Try again when it finishes.",
        });
      }
    }, TX);

    const row = await this.prisma.knowledgeSource.findUniqueOrThrow({
      where: { id: source.id },
    });

    return { source: sourceView(row) };
  }

  /**
   * The bytes are never proxied: a 300-second link is cheaper, and it keeps the
   * service key out of every response. A TEXT note has nothing to download.
   */
  async downloadLink(claims: AuthClaims, agentId: string, sourceId: string) {
    const { workspaceId } = await this.workspaces.primaryFor(claims);
    const agent = await this.agentOf(workspaceId, agentId);
    const source = await this.sourceOf(agent.id, sourceId);

    if (source.kind !== "FILE" || !source.storagePath) {
      throw new ConflictException({
        code: "SOURCE_NOT_FILE",
        message: "A typed note has no file to download.",
      });
    }

    return { url: await this.storage.signedUrl(source.storagePath), expiresIn: 300 };
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
      select: {
        id: true,
        kind: true,
        status: true,
        sha256: true,
        storagePath: true,
        title: true,
      },
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
   *
   * The row is held on a lease. Every write goes through `lease.guard`, under
   * the epoch the claim took, so a worker whose claim was handed on cannot
   * write chunks, vectors or a status after the fact — and the failure it would
   * otherwise record belongs to the newer attempt, not to it.
   */
  async index(sourceId: string): Promise<void> {
    const source = await this.loadForIndex(sourceId);

    if (!source || source.status !== "PROCESSING") return;

    const lease = this.lease(source.id, source.attempts);
    // What the provider charged for this attempt, recorded even when it fails.
    let spent = { embedTokens: 0, extractTokens: source.extractTokens };

    try {
      // The budget covers extraction as well as embedding, so the clock starts
      // before the first paid call rather than at the first batch.
      const started = Date.now();

      const extracted: Extracted =
        source.text && source.text.length > 0
          ? {
              blocks: [{ text: source.text }],
              meta: (source.meta as SourceMeta | null) ?? null,
              extractTokens: source.extractTokens,
            }
          : await this.readSource(source);

      // The heartbeat renews during extraction; this refuses to go on with a
      // claim that changed hands while the file was being read.
      await lease.renew();

      spent = { embedTokens: 0, extractTokens: extracted.extractTokens };

      const drafts = chunkBlocks(extracted.blocks);
      const text = extracted.blocks.map((block) => block.text).join("\n\n");

      if (drafts.length === 0) {
        throw new ExtractError("SOURCE_EMPTY", "There was no readable text in that source.");
      }

      if (drafts.length > MAX_CHUNKS) {
        throw new ExtractError(
          "SOURCE_TOO_LARGE",
          `That document splits into ${drafts.length} chunks, over the ${MAX_CHUNKS} limit. Split it or upload the part that matters.`,
        );
      }

      // A retry re-reads from storage; the old chunks must not outlive it. The
      // delete and the write share one transaction with the claim, so a requeue
      // either waits for both or fails the guard before either.
      await lease.guard(async (tx) => {
        await tx.knowledgeChunk.deleteMany({ where: { sourceId: source.id } });

        await tx.knowledgeChunk.createMany({
          data: drafts.map((chunk, ord) => ({
            sourceId: source.id,
            ord,
            text: chunk.text,
            tokens: estimateTokens(chunk.text),
            page: chunk.page ?? null,
            sheet: chunk.sheet ?? null,
            rowFrom: chunk.rowFrom ?? null,
            rowTo: chunk.rowTo ?? null,
            heading: chunk.heading ?? null,
          })),
        });
      });

      const rows = await this.prisma.knowledgeChunk.findMany({
        where: { sourceId: source.id },
        orderBy: { ord: "asc" },
        select: { id: true, text: true },
      });

      let embedTokens = 0;

      for (let at = 0; at < rows.length; at += EMBED_BATCH) {
        // Between batches, not mid-call: an HTTP request already in flight is
        // not aborted, so the job stops at the next boundary instead of
        // claiming a cancellation it cannot deliver. A batch already paid for
        // stays embedded, and a failed row loses its chunks in `fail`.
        if (Date.now() - started > this.jobBudgetMs) {
          throw new ExtractError(
            "SOURCE_TIMEOUT",
            "This file needed longer than one job is allowed, so embedding stopped at the last finished batch. Nothing was saved; try a smaller file, or split it and upload the part that matters.",
          );
        }

        const batch = rows.slice(at, at + EMBED_BATCH);
        const embedded = await this.provider.embed(batch.map((row) => row.text));

        embedTokens += embedded.tokens;
        spent = { embedTokens, extractTokens: extracted.extractTokens };

        // The vectors and the lease are one write: a vector cannot land under a
        // claim that has already been handed to another worker.
        await lease.guard(async (tx) => {
          for (let index = 0; index < batch.length; index += 1) {
            await tx.$executeRaw`
              UPDATE knowledge_chunks
              SET embedding = ${toVector(embedded.vectors[index])}::vector
              WHERE id = ${batch[index].id}::uuid
            `;
          }
        });
      }

      // The predecessor is read before the transaction so its object can be
      // removed after the commit, never before it.
      const predecessor = source.replacesSourceId
        ? await this.prisma.knowledgeSource.findFirst({
            where: { id: source.replacesSourceId, agentId: source.agentId },
            select: { id: true, storagePath: true },
          })
        : null;

      // Conditional on still owning the row: if ownership was lost mid-job the
      // newer attempt's status is the truth, and this one must not overwrite it.
      // The retirement shares the transaction, so the predecessor's bytes can
      // only go once this attempt is the one that made the successor READY.
      const { updated, retired } = await lease.guard(async (tx) => {
        const updated = await tx.knowledgeSource.updateMany({
          where: {
            id: source.id,
            status: "PROCESSING",
            attempts: source.attempts,
          },
          data: {
            text,
            charCount: text.length,
            chunkCount: rows.length,
            embedTokens,
            extractTokens: extracted.extractTokens,
            meta: extracted.meta ?? undefined,
            status: "READY",
            error: null,
            indexedAt: new Date(),
          },
        });

        const retired = predecessor
          ? await tx.knowledgeSource.deleteMany({
              where: {
                id: predecessor.id,
                agentId: source.agentId,
                // A row being read is a running job's subject: retiring it
                // would delete chunks out from under the worker that owns it.
                status: { not: "PROCESSING" },
                agent: { sources: { some: { id: source.id, status: "READY" } } },
              },
            })
          : { count: 0 };

        return { updated, retired };
      });

      if (updated.count > 0 && retired.count > 0 && predecessor?.storagePath) {
        // The bytes are the old version nobody can reach now. Best effort, and
        // only after the commit: the sweeper catches a failed delete.
        await this.storage.remove([predecessor.storagePath]);
      }

      if (updated.count > 0) {
        this.logger.log(
          `Indexed ${rows.length} chunks for source ${source.id} (${source.title}).`,
        );
      }
    } catch (error) {
      if (error instanceof OwnershipLost) {
        // Another worker owns the row now. Its status is the truth, and writing
        // FAILED here would be a lie about work this attempt no longer holds.
        this.logger.warn(
          `Source ${source.id} was reclaimed while it was being read; this attempt wrote nothing further.`,
        );
        return;
      }

      await this.fail(source.id, error, { epoch: source.attempts, ...spent });
    } finally {
      lease.stop();
    }
  }

  /**
   * The claim on one PROCESSING row, renewed for as long as the job runs.
   *
   * `attempts` is the epoch: `claim` leaves it alone, so the worker that took
   * the row knows which claim it holds; `recoverStale` increments it when it
   * hands a dead row on, so the old worker can tell it no longer owns anything.
   *
   * Every write the job makes runs through `guard`, whose first statement
   * re-takes the row under that epoch. The guard is the lock: a requeue either
   * waits for the write to commit or fails the guard before it runs, so chunks
   * and vectors cannot be written under a claim someone else holds. Renewals are
   * chained, so a heartbeat and a batch write cannot invalidate each other.
   */
  private lease(sourceId: string, epoch: number) {
    let chain: Promise<unknown> = Promise.resolve();

    const guard = <T>(
      run: (tx: Prisma.TransactionClient) => Promise<T>,
    ): Promise<T> => {
      const next = chain.then(() =>
        this.prisma.$transaction(async (tx) => {
          const held = await tx.knowledgeSource.updateMany({
            where: { id: sourceId, status: "PROCESSING", attempts: epoch },
            data: { updatedAt: new Date() },
          });

          if (held.count === 0) throw new OwnershipLost();

          return run(tx);
        }, TX),
      );

      chain = next.then(
        () => undefined,
        () => undefined,
      );

      return next;
    };

    // Extraction is minutes of work with no paid call to renew beside, so the
    // lease is refreshed on a timer; otherwise a slow PDF looks like a dead
    // process and a second worker pays for the same embeddings (B-16). The
    // timer is unref'd: it must never hold the process open.
    const timer = setInterval(() => {
      void guard(async () => undefined).catch((error: unknown) => {
        if (!(error instanceof OwnershipLost)) {
          this.logger.warn(
            `Could not renew the lease on source ${sourceId}: ${error instanceof Error ? error.message : "unknown error"}`,
          );
        }
      });
    }, LEASE_RENEW_MS);

    timer.unref();

    return {
      guard,
      renew: () => guard(async () => undefined),
      stop: () => clearInterval(timer),
    };
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
          agentId: true,
          kind: true,
          title: true,
          mime: true,
          storagePath: true,
          text: true,
          meta: true,
          extractTokens: true,
          replacesSourceId: true,
          status: true,
          attempts: true,
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
  }): Promise<Extracted> {
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
      const read = await this.media.read({
        bytes,
        mime,
        name: source.title,
        model: source.agent.model,
      });

      // What the paid read really cost, from the provider's own usage. Whisper
      // returns none, and zero is the honest number there.
      return { blocks: [{ text: read.text }], meta: null, extractTokens: read.tokens };
    }

    return extractSource({ bytes, mime, name: source.title });
  }

  /**
   * A failed source keeps its reason and loses its chunks: a half-indexed file
   * that answers is worse than one that says it could not be read.
   *
   * The failure is only recorded by the attempt that still owns the row. A
   * worker that lost its claim may not delete the chunks a newer attempt is
   * writing, and may not overwrite the newer attempt's status with its own
   * error — but the tokens it already spent are still its own to report.
   */
  private async fail(
    sourceId: string,
    error: unknown,
    options: {
      epoch?: number;
      embedTokens?: number;
      extractTokens?: number;
    } = {},
  ): Promise<void> {
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
    try {
      const owned = await this.prisma.$transaction(async (tx) => {
        const held = await tx.knowledgeSource.updateMany({
          where: {
            id: sourceId,
            status: "PROCESSING",
            ...(options.epoch === undefined ? {} : { attempts: options.epoch }),
          },
          data: {
            status: "FAILED",
            error: message,
            chunkCount: 0,
            ...(options.embedTokens === undefined
              ? {}
              : { embedTokens: options.embedTokens }),
            ...(options.extractTokens === undefined
              ? {}
              : { extractTokens: options.extractTokens }),
          },
        });

        // Somebody else holds the row: the chunks are theirs, not this
        // attempt's to delete.
        if (held.count === 0) return false;

        await tx.knowledgeChunk.deleteMany({ where: { sourceId } });

        return true;
      }, TX);

      if (!owned) {
        this.logger.warn(
          `Source ${sourceId} was reclaimed before its failure could be recorded; the owner's status stands.`,
        );
      }
    } catch (failure: unknown) {
      this.logger.warn(
        `Could not record the failure for source ${sourceId}: ${failure instanceof Error ? failure.message : "unknown error"}`,
      );
    }
  }

  /**
   * Return rows whose process died. Measured on `updatedAt`, so no second
   * timestamp column is needed; the capped ones are left FAILED rather than
   * looped forever.
   */
  async recoverStale(): Promise<void> {
    const cut = new Date(Date.now() - this.staleMs);

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
  extractTokens?: number | null;
  meta?: unknown;
  replacesSourceId?: string | null;
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
    extractTokens: row.extractTokens ?? 0,
    indexedAt: row.indexedAt ? row.indexedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    meta: (row.meta ?? null) as SourceView["meta"],
    replacesSourceId: row.replacesSourceId ?? null,
  };
}

/** The claim moved on: another worker owns the row, so this one writes nothing. */
class OwnershipLost extends Error {
  constructor() {
    super("This worker no longer owns the source it was reading.");
  }
}

/** Prisma's own name for a unique-index rejection. */
function isUniqueViolation(error: unknown): boolean {
  return prismaCodeOf(error) === "P2002";
}

/** The `code` Prisma puts on its known request errors, if this is one. */
function prismaCodeOf(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : null;
}
