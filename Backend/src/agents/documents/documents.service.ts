import { Injectable, Logger } from "@nestjs/common";

import {
  InboxSender,
  MAX_MEDIA_BYTES,
  type SendTarget,
} from "../../inbox/inbox.sender";
import { MediaStorage } from "../../inbox/media.storage";
import { PrismaService } from "../../prisma/prisma.service";
import { resolveMime } from "../knowledge.file";
import { pickDocument, wantsDocument } from "./document.match";

/** What became of a message that may have been asking for a file. */
export type DocumentDelivery =
  | { sent: true; messageId: string; name: string }
  | { sent: false; reason: "not-asked" | "no-match" | "unreadable" };

/**
 * The agent's own files, handed to a customer who asked for one by name.
 *
 * A request like "send me the brochure" has an answer that no paragraph can
 * give: the file. Everything needed for it is already stored — the operator's
 * upload is in the private `agent-sources` bucket under
 * `workspaces/{ws}/agents/{agent}/knowledge/{id}/original.{ext}`, with its
 * original name in `title` — so this class reads those bytes and hands them to
 * `InboxSender.media`, which already knows how to put a document on WhatsApp
 * with the right filename.
 *
 * Two rules shape the rest. Only the agent that is answering can reach its own
 * files: the query is scoped by agent and by the conversation's workspace, so a
 * tenant boundary is never a filter someone can forget. And this never throws:
 * a customer asked for a file and did not get one, which is a reason to keep
 * answering, not a reason to leave them in silence.
 *
 * It lives in `AgentsModule` on purpose. That module provides `MediaStorage`
 * bound to `agent-sources`; the inbox module's instance points at `inbox-media`,
 * and a download through it would 404 on every file.
 */
@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: MediaStorage,
    private readonly sender: InboxSender,
  ) {}

  /**
   * Send the file this message names, if it names one.
   *
   * The database is not read until the message has passed the ask test, which
   * is a few string comparisons: the overwhelming majority of messages are
   * questions, and a question costs nothing here.
   */
  async deliver(input: {
    workspaceId: string;
    agentId: string;
    question: string;
    target: SendTarget;
  }): Promise<DocumentDelivery> {
    if (!wantsDocument(input.question)) return { sent: false, reason: "not-asked" };

    const chosen = await this.choose(input);
    if (!chosen) return { sent: false, reason: "no-match" };

    const path = chosen.storagePath;
    if (!path) return { sent: false, reason: "no-match" };

    let bytes: Buffer;

    try {
      bytes = await this.storage.download(path);
    } catch (error) {
      // The row says the file exists; storage disagrees. The sweeper cannot
      // repair this, so it is worth a line, and the customer still gets an
      // answer from the text path.
      this.logger.warn(
        `Source ${chosen.id} could not be read back for sending: ${sentenceOf(error)}`,
      );
      return { sent: false, reason: "unreadable" };
    }

    try {
      const sent = await this.sender.media({
        ...input.target,
        file: {
          buffer: bytes,
          // The stored type, or the one the filename implies. `media` decides
          // image/document/video from it, and a document is what these are.
          mimetype: resolveMime(chosen.mime, chosen.title),
          // The operator's own filename, which is what the customer's phone
          // shows. A number or a trimmed slug would be unopenable-looking.
          originalname: chosen.title,
          size: bytes.length,
        },
        // No caption: WhatsApp already prints the filename under the document,
        // and a caption would be one more sentence to keep true in four
        // languages for no information gained.
        caption: null,
        quote: null,
        agentId: input.agentId,
      });

      this.logger.log(`Sent source ${chosen.id} (${chosen.title}) to a customer.`);

      return { sent: true, messageId: sent.id, name: chosen.title };
    } catch (error) {
      this.logger.warn(
        `Source ${chosen.id} could not be sent to the customer: ${sentenceOf(error)}`,
      );
      return { sent: false, reason: "unreadable" };
    }
  }

  /**
   * The agent's file that best fits the request.
   *
   * Read wider than it keeps. The same rule as retrieval applies: the ranking
   * decides after the rows are known, so the ones a tie-break will reject still
   * have to arrive.
   *
   * `status` is deliberately not a filter. Indexing is what lets the agent
   * answer questions *about* a file; it is not what makes the file itself
   * deliverable. The bytes are the operator's own upload, stored before
   * indexing ever begins — so a brochure whose text could not be extracted is
   * still exactly the brochure the customer asked for. Filtering on `READY`
   * made such a file permanently unsendable: a 32-page scan that outran the
   * indexing budget turned "send me the brochure" into a paragraph, forever,
   * with nothing on screen to connect the two. The refusal keeps its own
   * meaning where it belongs — on the Sources row, with a Retry beside it.
   *
   * The size cut is in SQL so an oversized upload is never downloaded just to be
   * refused.
   */
  private async choose(input: {
    workspaceId: string;
    agentId: string;
    question: string;
  }) {
    let rows: {
      id: string;
      title: string;
      mime: string | null;
      storagePath: string | null;
      updatedAt: Date;
    }[];

    try {
      rows = await this.prisma.knowledgeSource.findMany({
        where: {
          agentId: input.agentId,
          kind: "FILE",
          storagePath: { not: null },
          size: { lte: MAX_MEDIA_BYTES },
          // Defence in depth: `agentId` is already the tenant's, but a filter
          // that names the workspace cannot be satisfied by another one's row.
          agent: { workspaceId: input.workspaceId },
        },
        select: {
          id: true,
          title: true,
          mime: true,
          storagePath: true,
          updatedAt: true,
        },
        // Newest first, so the pure tie-break here and the database's own order
        // cannot disagree about which of two equal matches is "current".
        orderBy: { updatedAt: "desc" },
        take: 50,
      });
    } catch (error) {
      this.logger.warn(`Sources could not be read for a document request: ${sentenceOf(error)}`);
      return null;
    }

    return pickDocument(input.question, rows);
  }
}

function sentenceOf(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected failure.";
}