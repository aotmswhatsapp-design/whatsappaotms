import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * What a caller has to hand: a Prisma client. Typed as the one model this
 * module touches rather than `PrismaService`, so a helper reads the same
 * whether it is called from a Nest service or from a plain query.
 */
type AccountReader = Pick<PrismaClient, "whatsAppAccount">;

/**
 * The number a workspace answers from when nothing names one.
 *
 * Before a workspace could hold more than one number this was
 * `findUnique({ where: { workspaceId } })`. Now it is a choice, and the choice
 * is ordered rather than guessed: the row the workspace marked as default
 * first, then the oldest connection. That ordering also covers a workspace
 * whose only number predates `isDefault`, and one that has added numbers but
 * never marked any — the first one it connected keeps answering, so connecting
 * a second number cannot silently move live traffic.
 *
 * `select` is passed through because the callers disagree about what they may
 * read: a page load must not fetch the sealed access token, a send must.
 */
export function defaultAccount<S extends Prisma.WhatsAppAccountSelect>(
  prisma: AccountReader,
  workspaceId: string,
  select: S,
): Prisma.PrismaPromise<Prisma.WhatsAppAccountGetPayload<{ select: S }> | null> {
  return prisma.whatsAppAccount.findFirst({
    where: { workspaceId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select,
  });
}
