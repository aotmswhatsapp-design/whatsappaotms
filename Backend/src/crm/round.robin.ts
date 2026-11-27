import { Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";

export interface RosterRow {
  userId: string;
  role: string;
  designation: string | null;
  lastAssignedAt: Date | null;
}

/**
 * The rotation order, as a pure function so the statement's ORDER BY is
 * testable without a database: never picked first, then the oldest pick, then
 * the id so two members picked in the same instant still take turns.
 */
export function orderFor(rows: readonly RosterRow[], designation: string): RosterRow[] {
  return rows
    .filter((row) => row.role !== "OWNER" && row.designation === designation)
    .sort((left, right) => {
      const a = left.lastAssignedAt?.getTime() ?? -Infinity;
      const b = right.lastAssignedAt?.getTime() ?? -Infinity;

      if (a !== b) return a < b ? -1 : 1;
      return left.userId < right.userId ? -1 : left.userId > right.userId ? 1 : 0;
    });
}

/**
 * Hands one lead to the next member with the designation.
 *
 * One statement: the subquery locks the row it picks, so two deliveries at the
 * same instant get two different members instead of the same one twice. This
 * is why it is not an interactive transaction — the Supabase pooler cannot
 * carry one.
 */
@Injectable()
export class RoundRobin {
  constructor(private readonly prisma: PrismaService) {}

  async pick(workspaceId: string, designation: string): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<{ user_id: string }[]>`
      UPDATE workspace_members
         SET last_assigned_at = now()
       WHERE (workspace_id, user_id) = (
         SELECT workspace_id, user_id
           FROM workspace_members
          WHERE workspace_id = ${workspaceId}::uuid
            AND role <> 'OWNER'::"WorkspaceRole"
            AND designation = ${designation}
          ORDER BY last_assigned_at ASC NULLS FIRST, user_id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
       )
      RETURNING user_id;
    `;

    return rows[0]?.user_id ?? null;
  }
}
