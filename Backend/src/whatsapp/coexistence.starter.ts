import { Injectable, Logger } from "@nestjs/common";

import { SecretBox } from "../common/crypto/secret-box";
import { PrismaService } from "../prisma/prisma.service";
import { MetaGraph, MetaRequestError } from "./meta-graph";

export type SyncKind = "smb_app_state_sync" | "history";

/** The columns `begin` reads, so a caller can pass its own select's row. */
export interface AccountForSync {
  id: string;
  phoneNumberId: string;
  graphVersion: string;
  accessTokenCipher: string;
  onBizApp: boolean;
  stateSyncAt: Date | null;
  historySyncAt: Date | null;
}

/**
 * Asks Meta for the two synchronisations a coexistence number is entitled to.
 *
 * Runs at connect time and again on a reconnect, because the 24-hour clock
 * starts at onboarding and waiting for a screen visit risks the window. Never
 * throws: a connection that succeeded must not be reported as failed because
 * a follow-up call did not.
 */
@Injectable()
export class CoexistenceStarter {
  private readonly logger = new Logger(CoexistenceStarter.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly meta: MetaGraph,
    private readonly box: SecretBox,
  ) {}

  async begin(account: AccountForSync): Promise<void> {
    // A plain Cloud API number has no Business app data; asking would only
    // produce an error we would then have to explain away.
    if (!account.onBizApp) return;

    // Both already accepted: each kind may be performed once, so this is the
    // guard that makes a duplicate run (a reconnect and a retry racing) safe.
    if (account.stateSyncAt && account.historySyncAt) return;

    const token = this.openOrNull(account.accessTokenCipher);

    if (!token) {
      await this.recordFailure(
        account.id,
        "The stored access token can no longer be decrypted, so Meta cannot be asked for the sync. Reconnect.",
      );
      return;
    }

    // The documented order, and each kind skipped on its own stamp so a run
    // interrupted between the two resumes at the one that is missing.
    if (!account.stateSyncAt) {
      await this.request(account, token, "smb_app_state_sync");
    }

    if (!account.historySyncAt) {
      await this.request(account, token, "history");
    }
  }

  private async request(
    account: AccountForSync,
    token: string,
    syncType: SyncKind,
  ): Promise<void> {
    try {
      const { requestId } = await this.meta.requestSmbAppData({
        version: account.graphVersion,
        phoneNumberId: account.phoneNumberId,
        token,
        syncType,
      });

      // Written only after Meta accepted: a stamp on a refused request would
      // make the retry look unnecessary forever.
      await this.prisma.whatsAppAccount.update({
        where: { id: account.id },
        data:
          syncType === "history"
            ? {
                historySyncAt: new Date(),
                historySyncRequestId: requestId,
                historySyncError: null,
              }
            : { stateSyncAt: new Date(), stateSyncRequestId: requestId },
      });

      this.logger.log(
        `${syncType} requested for ${account.phoneNumberId} (${requestId ?? "no request id"}).`,
      );
    } catch (error) {
      const sentence = reasonOf(error);

      this.logger.warn(
        `Meta refused the ${syncType} request for ${account.phoneNumberId}: ${sentence}`,
      );

      await this.recordFailure(account.id, sentence);
    }
  }

  /** The one error column is the screen's sentence; never let it throw. */
  private async recordFailure(id: string, sentence: string): Promise<void> {
    try {
      await this.prisma.whatsAppAccount.update({
        where: { id },
        data: { historySyncError: sentence },
      });
    } catch (error) {
      this.logger.warn(
        `Could not record why the sync failed: ${
          error instanceof Error ? error.message : "unknown failure"
        }`,
      );
    }
  }

  private openOrNull(cipher: string): string | null {
    try {
      return this.box.open(cipher);
    } catch {
      return null;
    }
  }
}

function reasonOf(error: unknown): string {
  // `explanation` is the most specific sentence Meta gave us; the plain
  // message is the envelope, which names the call but not the problem.
  if (error instanceof MetaRequestError) return error.explanation;

  return error instanceof Error ? error.message : "Unexpected failure.";
}