import { HttpException, Injectable, Logger } from "@nestjs/common";
import type { RecipientStatus } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { Deliverer } from "./campaigns.delivery";
import {
  CAMPAIGN_SELECT,
  type CampaignRow,
  type SendAccount,
} from "./campaigns.types";

/** How many recipients one pass may send. */
const BATCH = 10;

/** A claim older than this is assumed dead and offered again. */
const STALE_CLAIM_MS = 60_000;

/** After this many lost claims the row is failed rather than retried again. */
const MAX_ATTEMPTS = 3;

/** One recipient, as the claim query returns it. */
interface ClaimedRecipient {
  id: string;
  contact_id: string;
  wa_id: string;
}

/**
 * The sending engine.
 *
 * There is no queue here and no Redis: the recipients table *is* the queue, and
 * the status column is the cursor. That is enough for one process, survives a
 * restart (a stale claim is offered again), and cannot double-send, because
 * claiming a batch is a single atomic statement.
 */
@Injectable()
export class CampaignsEngine {
  private readonly logger = new Logger(CampaignsEngine.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly deliverer: Deliverer,
  ) {}

  /**
   * The transition plus the audience snapshot.
   *
   * The `updateMany` is the lock: two callers (the runner's timer and an
   * agent pressing Start) race here, and exactly one gets `count: 1`.
   */
  async begin(id: string): Promise<boolean> {
    const claimed = await this.prisma.campaign.updateMany({
      where: { id, status: { in: ["DRAFT", "SCHEDULED"] } },
      data: { status: "RUNNING", startedAt: new Date() },
    });

    if (claimed.count === 0) return false;

    const campaign = await this.prisma.campaign.findUniqueOrThrow({
      where: { id },
      select: { workspaceId: true, audienceTags: true },
    });

    const contacts = await this.prisma.contact.findMany({
      where: {
        workspaceId: campaign.workspaceId,
        ...(campaign.audienceTags.length > 0
          ? { tags: { hasSome: campaign.audienceTags } }
          : {}),
      },
      select: { id: true, waId: true },
    });

    if (contacts.length === 0) {
      await this.finish(id);
      return true;
    }

    await this.prisma.campaignRecipient.createMany({
      data: contacts.map((contact) => ({
        campaignId: id,
        contactId: contact.id,
        waId: contact.waId,
      })),
      skipDuplicates: true,
    });

    await this.prisma.campaign.update({
      where: { id },
      data: { totalCount: contacts.length },
    });

    return true;
  }

  /** Every scheduled campaign whose time has come. */
  async claimDue(): Promise<void> {
    const due = await this.prisma.campaign.findMany({
      where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } },
      take: 3,
      select: { id: true },
    });

    for (const { id } of due) await this.begin(id);
  }

  /**
   * Offer dead claims again, but not forever. A row that has already lost
   * `MAX_ATTEMPTS - 1` claims would be pushed past the claim ceiling, so it is
   * failed here instead of lingering as PENDING and keeping the campaign open.
   */
  async releaseStale(): Promise<void> {
    const cut = new Date(Date.now() - STALE_CLAIM_MS);

    await this.prisma.campaignRecipient.updateMany({
      where: {
        status: "PENDING",
        claimedAt: { lt: cut },
        attempts: { gte: MAX_ATTEMPTS - 1 },
      },
      data: {
        status: "FAILED",
        claimedAt: null,
        errorReason: "The send was interrupted repeatedly and was not retried.",
      },
    });

    await this.prisma.campaignRecipient.updateMany({
      where: { status: "PENDING", claimedAt: { lt: cut } },
      data: { claimedAt: null, attempts: { increment: 1 } },
    });
  }

  async running(): Promise<CampaignRow[]> {
    return this.prisma.campaign.findMany({
      where: { status: "RUNNING" },
      orderBy: { startedAt: "asc" },
      take: 3,
      select: CAMPAIGN_SELECT,
    });
  }

  /**
   * One batch for one campaign. Nothing here throws: a single recipient's
   * failure is recorded on that recipient, because a campaign that stops at the
   * first bad number is worse than one that reports forty good sends.
   */
  async drain(campaign: CampaignRow): Promise<void> {
    const account = await this.accountFor(campaign.workspaceId);

    if (!account) {
      await this.stopForNoChannel(campaign.id);
      return;
    }

    const batch = await this.claim(campaign.id);

    if (batch.length === 0) {
      const left = await this.prisma.campaignRecipient.count({
        where: { campaignId: campaign.id, status: "PENDING" },
      });

      if (left === 0) await this.finish(campaign.id);
      return;
    }

    const pace = Math.max(50, Math.round(1000 / this.perSecond()));
    let sent = 0;
    let failed = 0;

    for (const recipient of batch) {
      try {
        const { messageId } = await this.deliverer.send({
          campaign,
          recipient: { contactId: recipient.contact_id, waId: recipient.wa_id },
          account,
          campaignId: campaign.id,
        });

        await this.prisma.campaignRecipient.update({
          where: { id: recipient.id },
          data: {
            status: "SENT",
            messageId,
            claimedAt: null,
            errorReason: null,
          },
        });
        sent += 1;
      } catch (error) {
        await this.prisma.campaignRecipient.update({
          where: { id: recipient.id },
          data: {
            status: "FAILED",
            claimedAt: null,
            errorReason: reasonOf(error),
          },
        });
        failed += 1;
        this.logger.warn(
          `Campaign ${campaign.id}: ${recipient.wa_id} failed — ${reasonOf(error)}`,
        );
      }

      await sleep(pace);
    }

    await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        sentCount: { increment: sent },
        failedCount: { increment: failed },
      },
    });
  }

  /** The workspace's single number, or null when nothing is connected. */
  async accountFor(workspaceId: string): Promise<SendAccount | null> {
    return this.prisma.whatsAppAccount.findUnique({
      where: { workspaceId },
      select: {
        id: true,
        phoneNumberId: true,
        graphVersion: true,
        accessTokenCipher: true,
      },
    });
  }

  /**
   * Claim up to ten pending rows atomically. Selecting and then updating would
   * leave a window where a second pass sees the same rows; one statement has
   * none.
   */
  private async claim(campaignId: string): Promise<ClaimedRecipient[]> {
    return this.prisma.$queryRaw<ClaimedRecipient[]>`
      UPDATE campaign_recipients
      SET claimed_at = now()
      WHERE id IN (
        SELECT id FROM campaign_recipients
        WHERE campaign_id = ${campaignId}::uuid
          AND status = 'PENDING'
          AND claimed_at IS NULL
          AND attempts < ${MAX_ATTEMPTS}
        ORDER BY created_at ASC
        LIMIT ${BATCH}
      )
      RETURNING id, contact_id, wa_id
    `;
  }

  private async stopForNoChannel(campaignId: string): Promise<void> {
    await this.prisma.campaignRecipient.updateMany({
      where: { campaignId, status: "PENDING" },
      data: {
        status: "SKIPPED",
        claimedAt: null,
        errorReason: "No WhatsApp number is connected.",
      },
    });

    await this.prisma.campaign.updateMany({
      where: { id: campaignId, status: { in: ["RUNNING", "PAUSED"] } },
      data: { status: "FAILED", ...(await this.recount(campaignId)) },
    });

    this.logger.warn(`Campaign ${campaignId} stopped: no channel connected.`);
  }

  /**
   * Closing counts, read from the recipient rows.
   *
   * The per-batch increments keep the progress visible while a campaign runs,
   * but a process that died mid-batch left them short. At the end the rows are
   * the truth, so they are counted once and written over the tally.
   */
  private async recount(campaignId: string): Promise<{
    totalCount: number;
    sentCount: number;
    failedCount: number;
    skippedCount: number;
  }> {
    const [totalCount, sentCount, failedCount, skippedCount] = await Promise.all(
      ["", "SENT", "FAILED", "SKIPPED"].map((status) =>
        this.prisma.campaignRecipient.count({
          where: {
            campaignId,
            ...(status ? { status: status as RecipientStatus } : {}),
          },
        }),
      ),
    );

    return { totalCount, sentCount, failedCount, skippedCount };
  }

  private async finish(campaignId: string): Promise<void> {
    await this.prisma.campaign.updateMany({
      where: { id: campaignId, status: "RUNNING" },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        ...(await this.recount(campaignId)),
      },
    });
  }

  /** Config is a number in seconds; anything unset falls back to five. */
  private perSecond(): number {
    const raw = Number(process.env.CAMPAIGN_SEND_PER_SECOND);
    return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 40) : 5;
  }
}

/** Meta's own sentence when it refused, so the recipient row explains itself. */
export function reasonOf(error: unknown): string {
  if (error instanceof HttpException) {
    const response = error.getResponse();

    if (typeof response === "string") return response;

    const message = (response as { message?: unknown }).message;

    return Array.isArray(message)
      ? message.join(" ")
      : typeof message === "string"
        ? message
        : error.message;
  }

  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
