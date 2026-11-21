import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import type { AuthClaims } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import type { UpdateBusinessProfileDto } from "./dto/update-business-profile.dto";

export interface BusinessProfilePayload {
  companyName: string | null;
  website: string | null;
  timezone: string;
  supportNumber: string | null;
  /**
   * Null until the first save. The form reads it to tell "never filled in" from
   * "saved as blank", which otherwise look identical.
   */
  updatedAt: string | null;
}

/** The default a workspace gets before it saves anything, matching the column. */
const DEFAULT_TIMEZONE = "Asia/Kolkata";

const SELECT = {
  companyName: true,
  website: true,
  timezone: true,
  supportNumber: true,
  updatedAt: true,
} satisfies Prisma.BusinessProfileSelect;

type ProfileRow = Prisma.BusinessProfileGetPayload<{ select: typeof SELECT }>;

/** Only the keys the caller actually sent; an absent key is not a change. */
type Change = {
  companyName?: string | null;
  website?: string | null;
  timezone?: string;
  supportNumber?: string | null;
};

/**
 * The workspace's own identity — the details the platform uses, not the ones
 * customers see on WhatsApp. Those live in Meta, and are read by the WhatsApp
 * module instead.
 */
@Injectable()
export class BusinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
  ) {}

  /**
   * A read never creates the row. The defaults below are what a fresh
   * workspace answers with, so opening the page twice writes nothing.
   */
  async read(claims: AuthClaims): Promise<BusinessProfilePayload> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    const row = await this.prisma.businessProfile.findUnique({
      where: { workspaceId },
      select: SELECT,
    });

    if (!row) {
      return {
        companyName: null,
        website: null,
        timezone: DEFAULT_TIMEZONE,
        supportNumber: null,
        updatedAt: null,
      };
    }

    return toPayload(row);
  }

  /** Upsert: the first save is also the row's creation, so there is one path. */
  async update(
    claims: AuthClaims,
    dto: UpdateBusinessProfileDto,
  ): Promise<BusinessProfilePayload> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);
    const change = changeSet(dto);

    const row = await this.prisma.businessProfile.upsert({
      where: { workspaceId },
      create: {
        workspaceId,
        companyName: change.companyName ?? null,
        website: change.website ?? null,
        supportNumber: change.supportNumber ?? null,
        ...(change.timezone ? { timezone: change.timezone } : {}),
      },
      update: change,
      select: SELECT,
    });

    return toPayload(row);
  }
}

function toPayload(row: ProfileRow): BusinessProfilePayload {
  return {
    companyName: row.companyName,
    website: row.website,
    timezone: row.timezone,
    supportNumber: row.supportNumber,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function changeSet(dto: UpdateBusinessProfileDto): Change {
  const change: Change = {};

  if (dto.companyName !== undefined) change.companyName = dto.companyName;
  if (dto.website !== undefined) change.website = dto.website;
  if (dto.supportNumber !== undefined) change.supportNumber = dto.supportNumber;

  // The column is NOT NULL with a default. An emptied input therefore keeps the
  // stored zone instead of failing the save with a database error.
  if (dto.timezone) change.timezone = dto.timezone;

  return change;
}
