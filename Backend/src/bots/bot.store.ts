import { Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";
import type { BotFlow } from "./bot.card";
import { flowIn } from "./bot.snapshot";

/**
 * Where a flow lives.
 *
 * Raw SQL on purpose. The table is a proposal that has not been applied
 * (`prisma/proposals/0025_bot_flows`), and a Prisma model would have to enter
 * `schema.prisma` to be typed — a schema that runs ahead of its migrations is
 * exactly the drift the proposal rule exists to prevent. Two statements are not
 * worth that trade.
 */
@Injectable()
export class BotStore {
  constructor(private readonly prisma: PrismaService) {}

  /** The stored flow, or `null` when this agent has never been saved. */
  async read(agentId: string): Promise<BotFlow | null> {
    const rows = await this.prisma.$queryRaw<{ data: unknown }[]>`
      SELECT "data" FROM "bot_flows" WHERE "agent_id" = ${agentId}::uuid LIMIT 1
    `;

    const row = rows[0];

    // A row that no longer reads as a flow is not a reason to fail the screen:
    // the shape is validated on write, and a null here becomes an empty flow.
    return row ? flowIn(row.data) : null;
  }

  /** One row per agent. The unique index on `agent_id` is what makes this an upsert. */
  async save(workspaceId: string, agentId: string, flow: BotFlow): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO "bot_flows" ("id", "workspace_id", "agent_id", "data")
      VALUES (gen_random_uuid(), ${workspaceId}::uuid, ${agentId}::uuid, ${JSON.stringify(flow)}::jsonb)
      ON CONFLICT ("agent_id") DO UPDATE
        SET "data" = EXCLUDED."data",
            "workspace_id" = EXCLUDED."workspace_id",
            "updated_at" = CURRENT_TIMESTAMP
    `;
  }

  /**
   * True when the failure is the table not existing.
   *
   * Prisma wraps a raw error rather than exposing the Postgres code, so the
   * sentence is the only handle. Both halves are checked: `42P01` alone would
   * also match an unrelated missing table.
   */
  static missingTable(error: unknown): boolean {
    const message = error instanceof Error ? error.message : "";

    return message.includes("bot_flows") && message.includes("does not exist");
  }
}
