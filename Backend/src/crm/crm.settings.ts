import { Injectable } from "@nestjs/common";

import type { AuthClaims } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import type { CrmSettingsDto } from "./crm.dto";

/** What intake follows, defaults already filled in. */
export interface RoutingPlan {
  /** The designation leads rotate to, or null when none can be resolved. */
  designation: string | null;
  /**
   * Exactly what the owner stored, before the single-designation fallback.
   * `read()` reports this and not `designation`, so an explicit choice is not
   * mistaken for "not chosen" once the roster happens to hold only one title.
   */
  storedDesignation: string | null;
  autoAssign: boolean;
  autoTask: boolean;
  taskDueHours: number;
}

export interface SettingsView {
  /** What the owner stored. Null means "not chosen", which the screen says. */
  leadDesignation: string | null;
  /** What rotation actually uses, including the single-designation fallback. */
  effectiveDesignation: string | null;
  autoAssign: boolean;
  autoTask: boolean;
  taskDueHours: number;
  /** Every designation on the roster, so the screen offers real choices. */
  designations: string[];
}

const DEFAULTS = { leadDesignation: null, autoAssign: true, autoTask: true, taskDueHours: 24 };

@Injectable()
export class CrmSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
  ) {}

  /**
   * The designations a lead can rotate to. The owner is left out: they run the
   * workspace, and rotating them in would quietly take leads from the people
   * hired for them.
   */
  async designations(workspaceId: string): Promise<string[]> {
    const rows = await this.prisma.workspaceMember.groupBy({
      by: ["designation"],
      where: {
        workspaceId,
        role: { not: "OWNER" },
        designation: { not: null },
      },
    });

    return rows
      .map((row) => row.designation)
      .filter((value): value is string => Boolean(value?.trim()))
      .sort((left, right) => left.localeCompare(right));
  }

  /**
   * The plan intake follows. A stored designation wins; otherwise, when the
   * roster carries exactly one, that one; otherwise nothing, and the lead
   * stays unassigned rather than guessing.
   */
  async plan(workspaceId: string): Promise<RoutingPlan> {
    const stored = await this.prisma.crmSettings.findUnique({
      where: { workspaceId },
      select: {
        leadDesignation: true,
        autoAssign: true,
        autoTask: true,
        taskDueHours: true,
      },
    });

    const row = stored ?? DEFAULTS;
    const storedDesignation = row.leadDesignation?.trim() || null;
    let designation = storedDesignation;

    if (!designation) {
      const roster = await this.designations(workspaceId);
      designation = roster.length === 1 ? roster[0] : null;
    }

    return {
      designation,
      storedDesignation,
      autoAssign: row.autoAssign,
      autoTask: row.autoTask,
      taskDueHours: row.taskDueHours,
    };
  }

  async read(claims: AuthClaims): Promise<SettingsView> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);
    const [plan, designations] = await Promise.all([
      this.plan(workspaceId),
      this.designations(workspaceId),
    ]);

    return {
      leadDesignation: plan.storedDesignation,
      effectiveDesignation: plan.designation,
      autoAssign: plan.autoAssign,
      autoTask: plan.autoTask,
      taskDueHours: plan.taskDueHours,
      designations,
    };
  }

  async save(claims: AuthClaims, dto: CrmSettingsDto): Promise<SettingsView> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    const data = {
      ...(dto.leadDesignation !== undefined
        ? { leadDesignation: dto.leadDesignation?.trim() || null }
        : {}),
      ...(dto.autoAssign !== undefined ? { autoAssign: dto.autoAssign } : {}),
      ...(dto.autoTask !== undefined ? { autoTask: dto.autoTask } : {}),
      ...(dto.taskDueHours !== undefined ? { taskDueHours: dto.taskDueHours } : {}),
    };

    await this.prisma.crmSettings.upsert({
      where: { workspaceId },
      create: { workspaceId, ...data },
      update: data,
    });

    return this.read(claims);
  }
}
