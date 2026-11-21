import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from "@nestjs/common";
import type { MessageKind, Prisma } from "@prisma/client";

import { SecretBox } from "../common/crypto/secret-box";
import { PrismaService } from "../prisma/prisma.service";
import {
  MetaRequestError,
  MetaShapeError,
  MetaTransportError,
} from "../whatsapp/meta-graph";
import { InboxGraph } from "./inbox.graph";
import {
  MESSAGE_SELECT,
  WINDOW_CLOSED_MESSAGE,
  messageView,
  previewOf,
  type MessageView,
} from "./inbox.view";
import { MediaStorage } from "./media.storage";

/** WhatsApp allows 100 MB documents; a body that large is not worth relaying. */
export const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

/** What Multer hands us from memory storage. */
export interface UploadedMedia {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

export interface AccountCredentials {
  phoneNumberId: string;
  graphVersion: string;
  accessTokenCipher: string;
}

export interface SendTarget {
  workspaceId: string;
  conversationId: string;
  /** The customer's digits-only number. */
  waId: string;
  account: AccountCredentials;
}

/**
 * Everything that leaves through the number: text, files, and the file a
 * customer sent us.
 *
 * The row is written before Meta is called, so a crash or a timeout still
 * leaves evidence of what was attempted. A rejection turns the row FAILED with
 * Meta's own sentence and answers 502; a closed 24-hour window answers 409 with
 * a code the composer can act on.
 */
@Injectable()
export class InboxSender {
  private readonly logger = new Logger(InboxSender.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: InboxGraph,
    private readonly storage: MediaStorage,
    private readonly box: SecretBox,
  ) {}

  async text(input: SendTarget & { body: string }): Promise<MessageView> {
    const row = await this.prisma.message.create({
      data: {
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        direction: "OUTBOUND",
        kind: "TEXT",
        status: "QUEUED",
        body: input.body,
      },
      select: MESSAGE_SELECT,
    });

    try {
      const wamid = await this.graph.sendText({
        version: input.account.graphVersion,
        token: this.tokenOf(input.account),
        phoneNumberId: input.account.phoneNumberId,
        to: input.waId,
        body: input.body,
      });

      const sentAt = new Date();

      const saved = await this.prisma.message.update({
        where: { id: row.id },
        data: { wamid, status: "SENT", sentAt },
        select: MESSAGE_SELECT,
      });

      await this.bump(input.conversationId, sentAt, previewOf(input.body, "Message"));

      return messageView(saved);
    } catch (error) {
      await this.markFailed(row.id, error);
      throw toHttp(error);
    }
  }

  /**
   * A template message. The row is written before Meta is called for the same
   * reason as a text reply: a crash still leaves evidence of what was tried.
   *
   * `body` is the message as the customer reads it, so the bubble and the
   * queue preview need no template rendering of their own.
   */
  async template(
    input: SendTarget & {
      name: string;
      language: string;
      components: unknown[];
      body: string;
      tapTarget: { url: string; title: string } | null;
    },
  ): Promise<MessageView> {
    const row = await this.prisma.message.create({
      data: {
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        direction: "OUTBOUND",
        kind: "TEMPLATE",
        status: "QUEUED",
        body: input.body,
        templateName: input.name,
        templateLanguage: input.language,
        ...(input.tapTarget
          ? { tapTarget: input.tapTarget as Prisma.InputJsonValue }
          : {}),
      },
      select: MESSAGE_SELECT,
    });

    try {
      const wamid = await this.graph.sendTemplate({
        version: input.account.graphVersion,
        token: this.tokenOf(input.account),
        phoneNumberId: input.account.phoneNumberId,
        to: input.waId,
        name: input.name,
        language: input.language,
        components: input.components,
      });

      const sentAt = new Date();

      const saved = await this.prisma.message.update({
        where: { id: row.id },
        data: { wamid, status: "SENT", sentAt },
        select: MESSAGE_SELECT,
      });

      await this.bump(
        input.conversationId,
        sentAt,
        previewOf(input.body, `Template · ${input.name}`),
      );

      return messageView(saved);
    } catch (error) {
      await this.markFailed(row.id, error);
      throw toHttp(error);
    }
  }

  async media(
    input: SendTarget & { file: UploadedMedia; caption: string | null },
  ): Promise<MessageView> {
    const { file } = input;

    if (!file.buffer || file.buffer.length === 0) {
      throw new BadRequestException("The file arrived empty.");
    }

    if (file.size > MAX_MEDIA_BYTES) {
      throw new PayloadTooLargeException("Files are limited to 25 MB.");
    }

    const kind = kindOfMime(file.mimetype);
    const name = file.originalname || null;

    const row = await this.prisma.message.create({
      data: {
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        direction: "OUTBOUND",
        kind,
        status: "QUEUED",
        mediaName: name,
        mediaMime: file.mimetype,
        mediaSize: file.size,
      },
      select: MESSAGE_SELECT,
    });

    const path = storagePath(input.workspaceId, row.id, file.mimetype, name);

    try {
      // Outbound bytes are kept before sending, so the thread can render its
      // own attachment even if Meta's copy expires.
      await this.storage.upload(path, file.buffer, file.mimetype);
    } catch (error) {
      await this.prisma.message
        .delete({ where: { id: row.id } })
        .catch(() => undefined);
      throw error;
    }

    try {
      const mediaId = await this.graph.uploadMedia({
        version: input.account.graphVersion,
        token: this.tokenOf(input.account),
        phoneNumberId: input.account.phoneNumberId,
        bytes: file.buffer,
        mime: file.mimetype,
        fileName: name ?? "file",
      });

      const wamid = await this.graph.sendMedia({
        version: input.account.graphVersion,
        token: this.tokenOf(input.account),
        phoneNumberId: input.account.phoneNumberId,
        to: input.waId,
        kind,
        mediaId,
        caption: input.caption,
        fileName: name,
      });

      const sentAt = new Date();

      const saved = await this.prisma.message.update({
        where: { id: row.id },
        data: { wamid, status: "SENT", sentAt, mediaId, mediaPath: path },
        select: MESSAGE_SELECT,
      });

      await this.bump(
        input.conversationId,
        sentAt,
        previewOf(input.caption, labelOf(kind)),
      );

      return messageView(saved);
    } catch (error) {
      await this.markFailed(row.id, error);
      throw toHttp(error);
    }
  }

  /**
   * The read receipt and typing bubble for the newest thing the customer said.
   *
   * Nothing here may surface as an error: the agent is mid-sentence, and a
   * banner over a reply that will send fine is worse than a bubble that never
   * appeared. A failure is logged with Meta's own sentence and reported as
   * `sent: false` so the composer can stay silent.
   *
   * The message id is ours to choose, not the client's — Meta only accepts an
   * id from the inbound webhook, and the newest one is what is being answered.
   */
  async typing(
    input: SendTarget,
  ): Promise<{ sent: boolean; reason: "no-inbound" | "meta" | null }> {
    const newest = await this.prisma.message.findFirst({
      where: {
        conversationId: input.conversationId,
        direction: "INBOUND",
        wamid: { not: null },
      },
      orderBy: { createdAt: "desc" },
      select: { wamid: true },
    });

    if (!newest?.wamid) return { sent: false, reason: "no-inbound" };

    try {
      await this.graph.markReadAndTyping({
        version: input.account.graphVersion,
        token: this.tokenOf(input.account),
        phoneNumberId: input.account.phoneNumberId,
        messageId: newest.wamid,
      });

      return { sent: true, reason: null };
    } catch (error) {
      this.logger.warn(`Typing indicator failed: ${reasonOf(error)}`);
      return { sent: false, reason: "meta" };
    }
  }

  /**
   * A signed URL for a message's file.
   *
   * Inbound bytes are downloaded from Meta on the first open and cached, which
   * is why this can take a second the first time and be immediate after that.
   */
  async attachment(input: {
    workspaceId: string;
    messageId: string;
  }): Promise<{ url: string; mime: string | null; name: string | null }> {
    const message = await this.prisma.message.findFirst({
      where: { id: input.messageId, workspaceId: input.workspaceId },
      select: {
        ...MESSAGE_SELECT,
        conversation: {
          select: {
            account: {
              select: { accessTokenCipher: true, graphVersion: true },
            },
          },
        },
      },
    });

    if (!message) {
      throw new NotFoundException("That message does not exist.");
    }

    if (message.mediaPath) {
      return {
        url: await this.storage.signedUrl(message.mediaPath),
        mime: message.mediaMime,
        name: message.mediaName,
      };
    }

    if (!message.mediaId) {
      throw new NotFoundException("This message has no attachment.");
    }

    const { account } = message.conversation;

    let fetched: { bytes: Buffer; mime: string | null };

    try {
      fetched = await this.graph.fetchMedia({
        version: account.graphVersion,
        token: this.box.open(account.accessTokenCipher),
        mediaId: message.mediaId,
      });
    } catch (error) {
      throw toHttp(error);
    }

    const mime = fetched.mime ?? message.mediaMime;
    const path = storagePath(input.workspaceId, message.id, mime, message.mediaName);

    await this.storage.upload(
      path,
      fetched.bytes,
      mime ?? "application/octet-stream",
    );

    await this.prisma.message.update({
      where: { id: message.id },
      data: {
        mediaPath: path,
        mediaMime: mime,
        mediaSize: message.mediaSize ?? fetched.bytes.length,
      },
    });

    return {
      url: await this.storage.signedUrl(path),
      mime,
      name: message.mediaName,
    };
  }

  private tokenOf(account: AccountCredentials): string {
    return this.box.open(account.accessTokenCipher);
  }

  private async markFailed(messageId: string, error: unknown): Promise<void> {
    await this.prisma.message
      .update({
        where: { id: messageId },
        data: { status: "FAILED", errorReason: reasonOf(error) },
      })
      .catch(() => undefined);
  }

  /** Keeps the queue ordered by what was said last. */
  private bump(conversationId: string, at: Date, preview: string): Promise<unknown> {
    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: at, lastMessagePreview: preview },
    });
  }
}

/**
 * Meta's sentence is what the agent can act on. 131047 is the one code worth
 * translating: it means the 24-hour window closed between page load and send.
 */
function toHttp(error: unknown): unknown {
  if (error instanceof MetaRequestError) {
    if (error.code === 131047) {
      return new ConflictException({
        code: "WINDOW_CLOSED",
        message: WINDOW_CLOSED_MESSAGE,
      });
    }

    return new BadGatewayException(reasonOf(error));
  }

  if (error instanceof MetaShapeError || error instanceof MetaTransportError) {
    return new BadGatewayException(error.message);
  }

  // An HttpException from storage or validation must keep its status.
  return error;
}

function reasonOf(error: unknown): string {
  if (error instanceof MetaShapeError || error instanceof MetaTransportError) {
    return error.message;
  }

  if (error instanceof MetaRequestError) {
    // `explanation` prefers Meta's `error_data.details`, which is the half of a
    // "(#100) Invalid parameter" answer that says what to change.
    return error.explanation;
  }

  if (error instanceof HttpException) return error.message;

  return error instanceof Error ? error.message : "Unexpected failure.";
}

function kindOfMime(mime: string): MessageKind {
  if (mime.startsWith("image/")) return "IMAGE";
  if (mime.startsWith("audio/")) return "AUDIO";
  if (mime.startsWith("video/")) return "VIDEO";
  return "DOCUMENT";
}

function labelOf(kind: MessageKind): string {
  switch (kind) {
    case "IMAGE":
      return "[image]";
    case "AUDIO":
      return "[audio]";
    case "VIDEO":
      return "[video]";
    case "STICKER":
      return "[sticker]";
    default:
      return "[document]";
  }
}

/** `w/{workspace}/{yyyy}/{mm}/{messageId}.{ext}` — the layout the spec fixed. */
function storagePath(
  workspaceId: string,
  messageId: string,
  mime: string | null,
  name: string | null,
): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");

  return `w/${workspaceId}/${now.getFullYear()}/${month}/${messageId}.${extensionOf(mime, name)}`;
}

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "application/pdf": "pdf",
  "text/plain": "txt",
};

function extensionOf(mime: string | null, name: string | null): string {
  const fromName = name?.split(".").pop()?.toLowerCase();

  if (fromName && /^[a-z0-9]{1,5}$/.test(fromName)) return fromName;

  return (mime && EXTENSIONS[mime]) || "bin";
}
