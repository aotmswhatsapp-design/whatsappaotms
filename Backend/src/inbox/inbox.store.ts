import { Injectable, Logger } from "@nestjs/common";
import type { MessageKind, MessageStatus, Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import type {
  ParsedChange,
  ParsedDeliveryStatus,
  ParsedMessage,
} from "./inbox.payload";
import { kindLabel } from "./inbox.view";

const PREVIEW_LIMIT = 140;

/** How far along the delivery chain a status is. FAILED is handled separately. */
const RANK: Record<MessageStatus, number> = {
  QUEUED: 0,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
  FAILED: 4,
};

export interface StoreAccount {
  id: string;
  workspaceId: string;
  phoneNumberId: string;
}

/** One inbound message this delivery actually inserted. */
export interface StoredInbound {
  conversationId: string;
  messageId: string;
  kind: MessageKind;
  body: string | null;
}

/**
 * Writes deliveries into the inbox.
 *
 * Deliberately not a `$transaction`: the runtime URL goes through Supabase's
 * transaction pooler, where Prisma's interactive transactions are unreliable.
 * Every write here is individually idempotent instead — `wamid` is unique, and
 * upserts key on the natural identity — so a retried delivery converges.
 */
@Injectable()
export class InboxStore {
  private readonly logger = new Logger(InboxStore.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Never throws into the webhook: a storage failure must not make Meta retry. */
  async record(
    account: StoreAccount,
    changes: ParsedChange[],
  ): Promise<StoredInbound[]> {
    const stored: StoredInbound[] = [];

    for (const change of changes) {
      if (change.phoneNumberId !== account.phoneNumberId) continue;

      try {
        stored.push(...(await this.applyChange(account, change)));
      } catch (error) {
        // No bodies, ever: this line reaches a hosting provider's log stream.
        this.logger.error(
          `Could not store a delivery for workspace ${account.workspaceId}: ${
            error instanceof Error ? error.message : "unknown failure"
          }`,
        );
      }
    }

    return stored;
  }

  private async applyChange(
    account: StoreAccount,
    change: ParsedChange,
  ): Promise<StoredInbound[]> {
    const stored: StoredInbound[] = [];

    for (const contact of change.contacts) {
      await this.prisma.contact.upsert({
        where: {
          workspaceId_waId: { workspaceId: account.workspaceId, waId: contact.waId },
        },
        create: {
          workspaceId: account.workspaceId,
          waId: contact.waId,
          profileName: contact.profileName,
          phoneDisplay: contact.waId,
          lastSeenAt: new Date(),
        },
        update: {
          lastSeenAt: new Date(),
          // A customer can hide their profile name; keep the last one we saw.
          ...(contact.profileName ? { profileName: contact.profileName } : {}),
        },
      });
    }

    for (const message of change.messages) {
      const row = await this.storeMessage(account, change, message);
      if (row) stored.push(row);
    }

    for (const status of change.statuses) {
      await this.applyStatus(status.wamid, status.status, status.error);
    }

    return stored;
  }

  private async storeMessage(
    account: StoreAccount,
    change: ParsedChange,
    message: ParsedMessage,
  ): Promise<StoredInbound | null> {
    const name = change.contacts.find((row) => row.waId === message.from);

    const contact = await this.prisma.contact.upsert({
      where: { workspaceId_waId: { workspaceId: account.workspaceId, waId: message.from } },
      create: {
        workspaceId: account.workspaceId,
        waId: message.from,
        profileName: name?.profileName ?? null,
        phoneDisplay: message.from,
        lastSeenAt: message.timestamp,
      },
      update: {
        lastSeenAt: message.timestamp,
        ...(name?.profileName ? { profileName: name.profileName } : {}),
      },
      select: { id: true },
    });

    const conversation = await this.prisma.conversation.upsert({
      where: { accountId_contactId: { accountId: account.id, contactId: contact.id } },
      create: {
        workspaceId: account.workspaceId,
        accountId: account.id,
        contactId: contact.id,
        lastInboundAt: message.timestamp,
        lastMessageAt: message.timestamp,
        lastMessagePreview: preview(message),
        unreadCount: 1,
      },
      update: {},
      select: { id: true, lastMessageAt: true },
    });

    const seen = await this.prisma.message.findUnique({
      where: { wamid: message.wamid },
      select: { id: true },
    });

    // Meta retries a delivery whenever it is unsure we received it.
    if (seen) return null;

    // An empty emoji is a removal of the customer's own reaction, not a new
    // message: keep the thread truthful by dropping the one it cancels.
    if (message.kind === "REACTION" && !message.body) {
      await this.prisma.message.deleteMany({
        where: {
          conversationId: conversation.id,
          direction: "INBOUND",
          kind: "REACTION",
          contextWamid: message.contextWamid,
        },
      });

      return null;
    }

    const saved = await this.prisma.message.create({
      data: {
        workspaceId: account.workspaceId,
        conversationId: conversation.id,
        direction: "INBOUND",
        kind: message.kind,
        // Inbound needs no tick; "delivered" is the truthful terminal state.
        status: "DELIVERED",
        wamid: message.wamid,
        body: message.body,
        mediaId: message.mediaId,
        mediaMime: message.mediaMime,
        mediaName: message.mediaName,
        mediaSha256: message.mediaSha256,
        contextWamid: message.contextWamid,
        ...(message.payload
          ? { payload: message.payload as unknown as Prisma.InputJsonValue }
          : {}),
        createdAt: message.timestamp,
      },
      select: { id: true },
    });

    // An old retry must not drag the thread back to the top of the list.
    const isNewest = message.timestamp >= conversation.lastMessageAt;

    // A reaction refreshes the customer-service window like any other message
    // from them, but it is not something an agent has to answer: counting it
    // as unread would put a red badge on a thread with nothing left to do, and
    // letting it rewrite the preview would hide the sentence it reacted to.
    const reacts = message.kind === "REACTION";

    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastInboundAt: message.timestamp,
        ...(reacts ? {} : { unreadCount: { increment: 1 } }),
        ...(isNewest && !reacts
          ? { lastMessageAt: message.timestamp, lastMessagePreview: preview(message) }
          : {}),
      },
    });

    return {
      conversationId: conversation.id,
      messageId: saved.id,
      kind: message.kind,
      body: message.body,
    };
  }

  private async applyStatus(
    wamid: string,
    next: ParsedDeliveryStatus,
    error: string | null,
  ) {
    const existing = await this.prisma.message.findUnique({
      where: { wamid },
      select: { id: true, status: true, deliveredAt: true },
    });

    if (!existing || !advances(existing.status, next)) return;

    const now = new Date();

    await this.prisma.message.update({
      where: { id: existing.id },
      data:
        next === "failed"
          ? { status: "FAILED", errorReason: error ?? "Meta rejected this message." }
          : {
              status: targetOf(next),
              ...(next === "delivered" ? { deliveredAt: now } : {}),
              // A "read" implies "delivered": Meta may skip the middle event.
              ...(next === "read"
                ? { readAt: now, deliveredAt: existing.deliveredAt ?? now }
                : {}),
            },
    });
  }
}

function advances(current: MessageStatus, next: ParsedDeliveryStatus): boolean {
  if (current === "READ") return false;
  if (next === "failed") return current === "QUEUED" || current === "SENT";

  return RANK[targetOf(next)] > RANK[current];
}

function targetOf(next: Exclude<ParsedDeliveryStatus, "failed">): MessageStatus {
  if (next === "sent") return "SENT";
  if (next === "delivered") return "DELIVERED";
  return "READ";
}

/** What the list shows when the message has no text of its own. */
function preview(message: ParsedMessage): string {
  if (message.body) return truncate(message.body);

  const label = kindLabel(message.kind);
  return message.mediaName ? `${label} ${message.mediaName}`.slice(0, PREVIEW_LIMIT) : label;
}

function truncate(text: string): string {
  return text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT - 1)}…` : text;
}
