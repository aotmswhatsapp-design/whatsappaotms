import type { PrismaService } from "../prisma/prisma.service";
import type { StoreAccount } from "./inbox.store";

/**
 * Who a thread hangs from.
 *
 * One rule, called by the live store and the history store: two copies would
 * drift, and the drift would show up as the same customer owning two threads.
 */
export interface ContactRef {
  phone: string | null;
  /**
   * Business-scoped user id (`user_id` / `from_user_id`). Resolved first in
   * B2; B1 has no column for it yet, so it is accepted and unused — which is
   * why the call sites do not change when the column arrives.
   */
  bsuid: string | null;
}

/**
 * `at` is the instant the contact was last seen *messaging us*. Null means
 * "here is what the phone book says", which must not move `lastSeenAt`: a
 * bought list would otherwise rank as the most active address book on earth.
 */
export function contactFor(
  prisma: PrismaService,
  account: StoreAccount,
  ref: ContactRef,
  profileName: string | null,
  at: Date | null,
): Promise<{ id: string } | null> {
  const phone = ref.phone;

  // No handle at all: the caller counts and skips. B2 adds the `bsuid`
  // branch above this line.
  if (!phone) return Promise.resolve(null);

  return prisma.contact.upsert({
    where: {
      workspaceId_waId: { workspaceId: account.workspaceId, waId: phone },
    },
    create: {
      workspaceId: account.workspaceId,
      waId: phone,
      profileName,
      phoneDisplay: phone,
      ...(at ? { lastSeenAt: at } : {}),
    },
    update: {
      ...(at ? { lastSeenAt: at } : {}),
      // A customer can hide their profile name; keep the last one we saw.
      ...(profileName ? { profileName } : {}),
    },
    select: { id: true },
  });
}