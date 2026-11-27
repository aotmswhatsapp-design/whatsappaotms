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

import type { BotCard, BotFlow } from "../bots/bot.card";
import { deliverCard } from "../bots/bot.render";
import { snapshotOf } from "../bots/bot.snapshot";
import { SecretBox } from "../common/crypto/secret-box";
import { PrismaService } from "../prisma/prisma.service";
import {
  MetaRequestError,
  MetaShapeError,
  MetaTransportError,
} from "../whatsapp/meta-graph";
import { InboxGraph, type ContactCardInput } from "./inbox.graph";
import type { LocationContents } from "./inbox.payload";
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

/** The message an agent answered: its row id for the client, its wamid for Meta. */
export interface Quote {
  id: string;
  wamid: string;
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

  async text(
    input: SendTarget & { body: string; quote: Quote | null; agentId?: string },
  ): Promise<MessageView> {
    const row = await this.prisma.message.create({
      data: {
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        direction: "OUTBOUND",
        kind: "TEXT",
        status: "QUEUED",
        body: input.body,
        contextWamid: input.quote?.wamid ?? null,
        ...(input.agentId ? { agentId: input.agentId } : {}),
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
        contextWamid: input.quote?.wamid ?? null,
      });

      const sentAt = new Date();

      const saved = await this.prisma.message.update({
        where: { id: row.id },
        data: { wamid, status: "SENT", sentAt },
        select: MESSAGE_SELECT,
      });

      await this.bump(input.conversationId, sentAt, previewOf(input.body, "Message"));

      return messageView(saved, quoteIndex(input.quote));
    } catch (error) {
      await this.markFailed(row.id, error);
      throw toHttp(error);
    }
  }

  /**
   * A card: the pictures, the information, and the buttons under them.
   *
   * The message is rendered here rather than passed in, so what is stored and
   * what Meta receives can never disagree about the ladder — three buttons, a
   * list, or numbered text — or about how many messages the card becomes.
   *
   * `payload` keeps the whole flow as it stood, not just the card that went out.
   * A tap is then answered from the payload: the next card is already in it, so
   * the conversation follows the menu the customer can see even after the
   * business has edited it, and no card table is needed to route. `body` is the
   * message as it reads in the thread, so the bubble and the queue preview need
   * no rendering of their own.
   */
  async interactive(
    input: SendTarget & {
      flow: BotFlow;
      card: BotCard;
      quote: Quote | null;
      agentId?: string;
    },
  ): Promise<{ message: MessageView; photos: MessageView[] }> {
    const delivery = deliverCard(input.card);

    // Pictures first, in order: the card is the last bubble, so the buttons the
    // customer is meant to tap sit under the photos rather than above them.
    // Each is a message of its own because WhatsApp has no album.
    const photos: MessageView[] = [];

    for (const link of delivery.photos) {
      const sent = await this.photo({
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        waId: input.waId,
        account: input.account,
        link,
        ...(input.agentId ? { agentId: input.agentId } : {}),
      });

      if (sent) photos.push(sent);
    }

    const rendered = delivery.message;

    const row = await this.prisma.message.create({
      data: {
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        direction: "OUTBOUND",
        // A card too large for buttons or rows is sent as text, and is stored
        // as the text it was, so the thread shows what the customer read.
        kind: rendered.kind === "text" ? "TEXT" : "INTERACTIVE",
        status: "QUEUED",
        body: rendered.body,
        contextWamid: input.quote?.wamid ?? null,
        payload: snapshotOf(input.flow, input.card.id) as unknown as Prisma.InputJsonValue,
        ...(input.agentId ? { agentId: input.agentId } : {}),
      },
      select: MESSAGE_SELECT,
    });

    try {
      const wamid =
        rendered.kind === "text"
          ? await this.graph.sendText({
              version: input.account.graphVersion,
              token: this.tokenOf(input.account),
              phoneNumberId: input.account.phoneNumberId,
              to: input.waId,
              body: rendered.body,
              contextWamid: input.quote?.wamid ?? null,
            })
          : await this.graph.sendInteractive({
              version: input.account.graphVersion,
              token: this.tokenOf(input.account),
              phoneNumberId: input.account.phoneNumberId,
              to: input.waId,
              interactive: rendered.interactive,
              contextWamid: input.quote?.wamid ?? null,
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
        previewOf(rendered.body, `Card · ${input.card.title}`),
      );

      return { message: messageView(saved, quoteIndex(input.quote)), photos };
    } catch (error) {
      await this.markFailed(row.id, error);
      throw toHttp(error);
    }
  }

  /**
   * One card picture as its own message.
   *
   * Its row is written before Meta is called, like every other send. A failed
   * picture never stops the card that follows it — the customer still needs the
   * buttons — and the row carries Meta's own sentence, so the thread can say
   * what happened instead of hiding it.
   */
  private async photo(
    input: SendTarget & { link: string; agentId?: string },
  ): Promise<MessageView | null> {
    const path = this.storage.pathInPublicUrl(input.link);

    const row = await this.prisma.message.create({
      data: {
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        direction: "OUTBOUND",
        kind: "IMAGE",
        status: "QUEUED",
        // Our own uploads are always the optimised JPEG, so the thread can sign
        // the stored copy. A pasted address from elsewhere has no path here;
        // the link travels in `payload` and the bubble reads it from there.
        ...(path ? { mediaPath: path, mediaMime: "image/jpeg" } : {}),
        payload: { image: { link: input.link } } as Prisma.InputJsonValue,
        ...(input.agentId ? { agentId: input.agentId } : {}),
      },
      select: MESSAGE_SELECT,
    });

    try {
      const wamid = await this.graph.sendImageLink({
        version: input.account.graphVersion,
        token: this.tokenOf(input.account),
        phoneNumberId: input.account.phoneNumberId,
        to: input.waId,
        link: input.link,
        caption: null,
        contextWamid: null,
      });

      const sentAt = new Date();

      const saved = await this.prisma.message.update({
        where: { id: row.id },
        data: { wamid, status: "SENT", sentAt },
        select: MESSAGE_SELECT,
      });

      await this.bump(input.conversationId, sentAt, "Photo");

      return messageView(saved);
    } catch (error) {
      this.logger.warn(`A card picture was not delivered: ${reasonOf(error)}`);

      return this.markFailed(row.id, error);
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
      /** Set when a campaign sent it; the campaign's insights are a groupBy
       * over exactly these rows. */
      campaignId?: string;
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
        ...(input.campaignId ? { campaignId: input.campaignId } : {}),
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
    input: SendTarget & {
      file: UploadedMedia;
      caption: string | null;
      quote: Quote | null;
    },
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
        contextWamid: input.quote?.wamid ?? null,
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
        contextWamid: input.quote?.wamid ?? null,
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

      return messageView(saved, quoteIndex(input.quote));
    } catch (error) {
      await this.markFailed(row.id, error);
      throw toHttp(error);
    }
  }

  /**
   * A location pin.
   *
   * The stored payload is the same shape a customer's shared pin arrives in,
   * so one bubble can draw both directions.
   */
  async location(
    input: SendTarget & LocationContents,
  ): Promise<MessageView> {
    const contents: LocationContents = {
      latitude: input.latitude,
      longitude: input.longitude,
      name: input.name,
      address: input.address,
    };

    const row = await this.prisma.message.create({
      data: {
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        direction: "OUTBOUND",
        kind: "LOCATION",
        status: "QUEUED",
        body: input.name ?? "Location",
        payload: contents as unknown as Prisma.InputJsonValue,
      },
      select: MESSAGE_SELECT,
    });

    try {
      const wamid = await this.graph.sendLocation({
        version: input.account.graphVersion,
        token: this.tokenOf(input.account),
        phoneNumberId: input.account.phoneNumberId,
        to: input.waId,
        latitude: input.latitude,
        longitude: input.longitude,
        name: input.name,
        address: input.address,
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
        previewOf(input.name ?? input.address, "[location]"),
      );

      return messageView(saved);
    } catch (error) {
      await this.markFailed(row.id, error);
      throw toHttp(error);
    }
  }

  /** One or more contact cards. `body` is the names, so the queue has a preview. */
  async contacts(
    input: SendTarget & { contacts: ContactCardInput[] },
  ): Promise<MessageView> {
    const names = input.contacts.map((card) => card.name).join(", ");

    const row = await this.prisma.message.create({
      data: {
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        direction: "OUTBOUND",
        kind: "CONTACTS",
        status: "QUEUED",
        body: names,
        payload: { contacts: input.contacts } as unknown as Prisma.InputJsonValue,
      },
      select: MESSAGE_SELECT,
    });

    try {
      const wamid = await this.graph.sendContacts({
        version: input.account.graphVersion,
        token: this.tokenOf(input.account),
        phoneNumberId: input.account.phoneNumberId,
        to: input.waId,
        contacts: input.contacts,
      });

      const sentAt = new Date();

      const saved = await this.prisma.message.update({
        where: { id: row.id },
        data: { wamid, status: "SENT", sentAt },
        select: MESSAGE_SELECT,
      });

      await this.bump(input.conversationId, sentAt, previewOf(names, "[contact card]"));

      return messageView(saved);
    } catch (error) {
      await this.markFailed(row.id, error);
      throw toHttp(error);
    }
  }

  /**
   * One emoji on one message, or the removal of the one we sent before.
   *
   * Meta keeps a single reaction per sender per message, so the newer row
   * retires the older one instead of stacking. A removal deletes ours only
   * after Meta agrees, so the thread never shows a chip that still exists on
   * the customer's phone. Reactions do not touch the queue preview: an emoji
   * is not a sentence, and hiding the last real message behind it would be.
   */
  async reaction(
    input: SendTarget & { target: Quote; emoji: string },
  ): Promise<MessageView | null> {
    const previous = await this.prisma.message.findFirst({
      where: {
        conversationId: input.conversationId,
        direction: "OUTBOUND",
        kind: "REACTION",
        contextWamid: input.target.wamid,
      },
      select: { id: true },
    });

    if (input.emoji.length === 0) {
      try {
        await this.graph.sendReaction({
          version: input.account.graphVersion,
          token: this.tokenOf(input.account),
          phoneNumberId: input.account.phoneNumberId,
          to: input.waId,
          messageId: input.target.wamid,
          emoji: "",
        });
      } catch (error) {
        throw toHttp(error);
      }

      if (previous) {
        await this.prisma.message
          .delete({ where: { id: previous.id } })
          .catch(() => undefined);
      }

      return null;
    }

    const row = await this.prisma.message.create({
      data: {
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        direction: "OUTBOUND",
        kind: "REACTION",
        status: "QUEUED",
        body: input.emoji,
        contextWamid: input.target.wamid,
      },
      select: MESSAGE_SELECT,
    });

    try {
      const wamid = await this.graph.sendReaction({
        version: input.account.graphVersion,
        token: this.tokenOf(input.account),
        phoneNumberId: input.account.phoneNumberId,
        to: input.waId,
        messageId: input.target.wamid,
        emoji: input.emoji,
      });

      const saved = await this.prisma.message.update({
        where: { id: row.id },
        data: { wamid, status: "SENT", sentAt: new Date() },
        select: MESSAGE_SELECT,
      });

      if (previous) {
        await this.prisma.message
          .delete({ where: { id: previous.id } })
          .catch(() => undefined);
      }

      return messageView(saved, quoteIndex(input.target));
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
    const newest = await this.newestInbound(input.conversationId);

    if (!newest) return { sent: false, reason: "no-inbound" };

    try {
      await this.graph.markReadAndTyping({
        version: input.account.graphVersion,
        token: this.tokenOf(input.account),
        phoneNumberId: input.account.phoneNumberId,
        messageId: newest,
      });

      return { sent: true, reason: null };
    } catch (error) {
      this.logger.warn(`Typing indicator failed: ${reasonOf(error)}`);
      return { sent: false, reason: "meta" };
    }
  }

  /**
   * The receipt on its own, sent when an agent opens a thread.
   *
   * Same contract as the typing bubble: it is a courtesy, so a refusal is
   * logged and swallowed rather than shown over a conversation that is fine.
   */
  async read(
    input: SendTarget,
  ): Promise<{ sent: boolean; reason: "no-inbound" | "meta" | null }> {
    const newest = await this.newestInbound(input.conversationId);

    if (!newest) return { sent: false, reason: "no-inbound" };

    try {
      await this.graph.markRead({
        version: input.account.graphVersion,
        token: this.tokenOf(input.account),
        phoneNumberId: input.account.phoneNumberId,
        messageId: newest,
      });

      return { sent: true, reason: null };
    } catch (error) {
      this.logger.warn(`Read receipt failed: ${reasonOf(error)}`);
      return { sent: false, reason: "meta" };
    }
  }

  /** The wamid Meta accepts in `status: read` — the newest inbound one. */
  private async newestInbound(conversationId: string): Promise<string | null> {
    const row = await this.prisma.message.findFirst({
      where: {
        conversationId,
        direction: "INBOUND",
        wamid: { not: null },
      },
      orderBy: { createdAt: "desc" },
      select: { wamid: true },
    });

    return row?.wamid ?? null;
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

    // Meta hands the bytes back only to the number's token, and a disconnected
    // row no longer has one. The message itself is still readable — only the
    // download waits for a reconnect.
    if (!account.accessTokenCipher) {
      throw new ConflictException({
        code: "NO_CHANNEL",
        message:
          "The number that received this file is disconnected, so WhatsApp will not hand it back. Reconnect the number and open it again.",
      });
    }

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

  private async markFailed(
    messageId: string,
    error: unknown,
  ): Promise<MessageView | null> {
    const failed = await this.prisma.message
      .update({
        where: { id: messageId },
        data: { status: "FAILED", errorReason: reasonOf(error) },
        select: MESSAGE_SELECT,
      })
      .catch(() => null);

    return failed ? messageView(failed) : null;
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

/**
 * The quote, as the index `messageView` resolves `contextWamid` against — so a
 * just-sent reply carries the message it answered without a second read.
 */
function quoteIndex(quote: Quote | null): Map<string, string> | undefined {
  return quote ? new Map([[quote.wamid, quote.id]]) : undefined;
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
