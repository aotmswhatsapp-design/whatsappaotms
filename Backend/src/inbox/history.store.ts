import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import type {
  HistoryMessage,
  HistoryThread,
  MediaAsset,
  SyncedContact,
} from "../whatsapp/coexistence";
import { contactFor } from "./contact.identity";
import type { StoreAccount } from "./inbox.store";
import { kindLabel } from "./inbox.view";

/** Meta caps a chunk in the thousands; 500 keeps one statement modest. */
const BATCH = 500;

const WINDOW_MS = 24 * 60 * 60 * 1000;

const PREVIEW_LIMIT = 140;

/**
 * Writes what the WhatsApp Business app shares into the inbox we already have.
 *
 * Same rules as the live store, for the same reasons: `wamid` is the dedupe
 * key, ordering is decided by an atomic `updateMany ... lt` rather than a read
 * then write, and nothing here returns a row to the reply or lead pipelines —
 * which is what keeps 180 days of history from being answered by a bot.
 */
@Injectable()
export class HistoryStore {
  private readonly logger = new Logger(HistoryStore.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Writes one chunk of threads. Never throws into the webhook. */
  async import(
    account: StoreAccount,
    threads: HistoryThread[],
  ): Promise<{ written: number; skipped: number }> {
    let written = 0;
    let skipped = 0;

    for (const thread of threads) {
      // A delivery can name several numbers; each account takes only its own.
      if (thread.phoneNumberId !== account.phoneNumberId) continue;

      try {
        const result = await this.importThread(account, thread);
        written += result.written;
        skipped += result.skipped;
      } catch (error) {
        this.logger.error(
          `Could not import history for workspace ${account.workspaceId}: ${
            error instanceof Error ? error.message : "unknown failure"
          }`,
        );
      }
    }

    return { written, skipped };
  }

  private async importThread(
    account: StoreAccount,
    thread: HistoryThread,
  ): Promise<{ written: number; skipped: number }> {
    if (thread.messages.length === 0) return { written: 0, skipped: 0 };

    const newest = newestOf(thread.messages);
    const conversation = await this.conversationFor(
      account,
      thread,
      newest.at,
      previewOf(newest),
    );

    if (!conversation) {
      this.logger.log(
        `Skipped a history thread for ${account.phoneNumberId}: Meta named no phone number (first message ${thread.messages[0].wamid}).`,
      );
      return { written: 0, skipped: thread.messages.length };
    }

    let written = 0;

    for (let index = 0; index < thread.messages.length; index += BATCH) {
      const { count } = await this.prisma.message.createMany({
        data: thread.messages
          .slice(index, index + BATCH)
          .map((message) => rowOf(account, conversation.id, message)),
        skipDuplicates: true,
      });

      written += count;
    }

    await this.touch(conversation.id, newest.at, previewOf(newest));

    const newestInbound = newestInboundOf(thread.messages);

    // Only a message younger than the window can open one, and only forward:
    // over-reporting hands an agent a free-form send Meta will reject, which
    // costs more than under-reporting it.
    if (newestInbound && Date.now() - newestInbound.at.getTime() < WINDOW_MS) {
      await this.prisma.conversation.updateMany({
        where: {
          id: conversation.id,
          OR: [
            { lastInboundAt: null },
            { lastInboundAt: { lt: newestInbound.at } },
          ],
        },
        data: { lastInboundAt: newestInbound.at },
      });
    }

    return { written, skipped: 0 };
  }

  /** Fills a placeholder, or creates the row when the asset beat its chunk. */
  async attachMedia(account: StoreAccount, asset: MediaAsset): Promise<void> {
    if (asset.phoneNumberId !== account.phoneNumberId) return;

    const filled = await this.prisma.message.updateMany({
      where: {
        wamid: asset.wamid,
        kind: "MEDIA_PENDING",
        workspaceId: account.workspaceId,
      },
      data: {
        kind: asset.kind,
        mediaId: asset.mediaId,
        mediaMime: asset.mediaMime,
        mediaSha256: asset.mediaSha256,
        body: asset.caption,
      },
    });

    if (filled.count > 0) return;

    // A live row already owns this wamid, with better data than an asset. It
    // also cannot be replaced: `wamid` is unique and the live row is the one
    // the customer's own delivery wrote.
    const existing = await this.prisma.message.findUnique({
      where: { wamid: asset.wamid },
      select: { id: true },
    });

    if (existing) return;

    const business = digitsOf(account.displayPhoneNumber);

    // A business-sent asset names the business as its sender and nothing about
    // the recipient, so there is no thread to write it into. Its placeholder
    // arrives on the chunk that carries the thread.
    if (!asset.from || asset.from === business) {
      this.logger.log(
        `A history media asset for ${account.phoneNumberId} has no placeholder and no customer to attach to (${asset.wamid}).`,
      );
      return;
    }

    const conversation = await this.conversationFor(
      account,
      { phone: asset.from, bsuid: null, username: null },
      asset.at,
      previewOf({ body: asset.caption, kind: asset.kind }),
    );

    if (!conversation) return;

    await this.prisma.message.create({
      data: {
        workspaceId: account.workspaceId,
        conversationId: conversation.id,
        direction: "INBOUND",
        kind: asset.kind,
        status: "DELIVERED",
        wamid: asset.wamid,
        body: asset.caption,
        mediaId: asset.mediaId,
        mediaMime: asset.mediaMime,
        mediaSha256: asset.mediaSha256,
        imported: true,
        createdAt: asset.at,
      },
    });

    await this.touch(
      conversation.id,
      asset.at,
      previewOf({ body: asset.caption, kind: asset.kind }),
    );
  }

  /** Applies the address book. Returns how many contacts were written. */
  async absorbContacts(
    account: StoreAccount,
    contacts: SyncedContact[],
  ): Promise<number> {
    let applied = 0;

    for (const row of contacts) {
      if (row.phoneNumberId !== account.phoneNumberId) continue;

      if (row.action === "remove") {
        // The contact may own a conversation, and deleting the row would
        // delete the thread with it.
        this.logger.log(
          `Ignored a contact removal for ${account.phoneNumberId}: the row may own a conversation.`,
        );
        continue;
      }

      if (!row.phone) continue;

      const name = row.fullName ?? row.firstName;

      await this.prisma.contact.upsert({
        where: {
          workspaceId_waId: { workspaceId: account.workspaceId, waId: row.phone },
        },
        create: {
          workspaceId: account.workspaceId,
          waId: row.phone,
          profileName: name,
          phoneDisplay: row.phone,
        },
        // No `lastSeenAt`: a phone-book entry is not a sighting.
        update: {
          phoneDisplay: row.phone,
          ...(name ? { profileName: name } : {}),
        },
      });

      applied += 1;
    }

    return applied;
  }

  /** Meta reported `progress: 100`. */
  async noteComplete(account: StoreAccount): Promise<void> {
    await this.prisma.whatsAppAccount.update({
      where: { id: account.id },
      data: { historySyncDoneAt: new Date() },
    });
  }

  /** The business turned history sharing off; `sentence` is Meta's own title. */
  async noteDeclined(account: StoreAccount, sentence: string): Promise<void> {
    await this.prisma.whatsAppAccount.update({
      where: { id: account.id },
      data: { historySyncDoneAt: new Date(), historySyncError: sentence },
    });
  }

  /** The thread's identity: the contact rule, then the one conversation. */
  private async conversationFor(
    account: StoreAccount,
    ref: { phone: string | null; bsuid: string | null; username: string | null },
    at: Date,
    preview: string,
  ): Promise<{ id: string } | null> {
    const contact = await contactFor(
      this.prisma,
      account,
      { phone: ref.phone, bsuid: ref.bsuid },
      ref.username,
      // A phone-book name is not a sighting; only a message is.
      null,
    );

    if (!contact) return null;

    return this.prisma.conversation.upsert({
      where: {
        accountId_contactId: { accountId: account.id, contactId: contact.id },
      },
      create: {
        workspaceId: account.workspaceId,
        accountId: account.id,
        contactId: contact.id,
        // 180 days must not arrive as red badges.
        unreadCount: 0,
        lastMessageAt: at,
        lastMessagePreview: preview,
      },
      update: {},
      select: { id: true },
    });
  }

  /** Atomic so two chunks racing on one thread cannot reorder it. */
  private async touch(
    conversationId: string,
    at: Date,
    preview: string,
  ): Promise<void> {
    await this.prisma.conversation.updateMany({
      where: { id: conversationId, lastMessageAt: { lt: at } },
      data: { lastMessageAt: at, lastMessagePreview: preview },
    });
  }
}

function rowOf(
  account: StoreAccount,
  conversationId: string,
  message: HistoryMessage,
): Prisma.MessageCreateManyInput {
  return {
    workspaceId: account.workspaceId,
    conversationId,
    direction: message.direction,
    kind: message.kind,
    status: message.status,
    wamid: message.wamid,
    body: message.body,
    mediaId: message.mediaId,
    mediaMime: message.mediaMime,
    mediaSha256: message.mediaSha256,
    errorReason: message.errorReason,
    imported: true,
    createdAt: message.at,
  };
}

function newestOf(messages: HistoryMessage[]): HistoryMessage {
  return messages.reduce((newest, message) =>
    message.at > newest.at ? message : newest,
  );
}

function newestInboundOf(messages: HistoryMessage[]): HistoryMessage | null {
  const inbound = messages.filter((message) => message.direction === "INBOUND");
  return inbound.length > 0 ? newestOf(inbound) : null;
}

/** What the thread list shows in place of words: the text, or the kind. */
function previewOf(row: {
  body: string | null;
  kind: HistoryMessage["kind"];
}): string {
  const text = row.body?.trim() || kindLabel(row.kind);
  return text.length > PREVIEW_LIMIT
    ? `${text.slice(0, PREVIEW_LIMIT - 1)}…`
    : text;
}

function digitsOf(value: string | null | undefined): string | null {
  return value ? value.replace(/\D/g, "") || null : null;
}