import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import type { AuthClaims } from "../auth/auth.types";
import { problemsIn, shapeOf } from "../inbox/template-send";
import { PrismaService } from "../prisma/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { bindingsOf, problemsInBindings } from "./campaign.values";
import { Deliverer } from "./campaigns.delivery";
import { CampaignsEngine } from "./campaigns.engine";
import {
  buttonUrlsOf,
  CAMPAIGN_SELECT,
  type CampaignRow,
  type InsightBuckets,
} from "./campaigns.types";
import {
  campaignView,
  iso,
  type CampaignView,
  type RecipientView,
} from "./campaigns.view";
import type { CreateCampaignDto } from "./dto/create-campaign.dto";
import type { ListCampaignsDto } from "./dto/list-campaigns.dto";
import type { TestCampaignDto } from "./dto/test-campaign.dto";
import type { UpdateCampaignDto } from "./dto/update-campaign.dto";

/** The audience rule, in one function so count and send cannot disagree. */
function audienceWhere(workspaceId: string, tags: string[]) {
  return {
    workspaceId,
    ...(tags.length > 0 ? { tags: { hasSome: tags } } : {}),
  } satisfies Prisma.ContactWhereInput;
}

/** A page of recipients, cursor on the row id. */
const RECIPIENT_PAGE = 50;

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly engine: CampaignsEngine,
    private readonly deliverer: Deliverer,
  ) {}

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  /** What the create panel needs: approved templates, tags, and a number. */
  async options(claims: AuthClaims) {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    const [templates, tags, channel] = await Promise.all([
      this.prisma.messageTemplate.findMany({
        where: { workspaceId, status: "APPROVED" },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          name: true,
          language: true,
          category: true,
          components: true,
        },
      }),
      this.prisma.$queryRaw<{ tag: string }[]>`
        SELECT DISTINCT unnest(tags) AS tag
        FROM contacts
        WHERE workspace_id = ${workspaceId}::uuid
        ORDER BY tag
      `,
      this.prisma.whatsAppAccount.findUnique({
        where: { workspaceId },
        select: { phoneNumberId: true, displayPhoneNumber: true, verifiedName: true },
      }),
    ]);

    return {
      templates: templates.map((row) => ({
        id: row.id,
        name: row.name,
        language: row.language,
        category: row.category,
        shape: shapeOf(row.components),
      })),
      tags: tags.map((row) => row.tag).filter(Boolean),
      channel: {
        connected: channel !== null,
        display:
          channel?.displayPhoneNumber ?? channel?.verifiedName ?? null,
        phoneNumberId: channel?.phoneNumberId ?? null,
      },
    };
  }

  /**
   * The audience, measured now. Never cached and never the client's number:
   * the count on screen has to be the list that will actually be sent to.
   */
  async audience(claims: AuthClaims, tags: string[]) {
    const { workspaceId } = await this.workspaces.primaryFor(claims);
    const where = audienceWhere(workspaceId, tags);

    const [total, sample] = await Promise.all([
      this.prisma.contact.count({ where }),
      this.prisma.contact.findMany({
        where,
        take: 5,
        orderBy: { createdAt: "asc" },
        select: { profileName: true, waId: true, phoneDisplay: true },
      }),
    ]);

    return { total, sample };
  }

  async list(claims: AuthClaims, query: ListCampaignsDto) {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    const rows = await this.prisma.campaign.findMany({
      where: { workspaceId, ...(query.status ? { status: query.status } : {}) },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: CAMPAIGN_SELECT,
    });

    // One aggregation for the page instead of one query per row.
    const buckets =
      rows.length === 0
        ? []
        : await this.prisma.message.groupBy({
            by: ["campaignId", "status"],
            where: { campaignId: { in: rows.map((row) => row.id) } },
            _count: { _all: true },
          });

    const byCampaign = new Map<string, InsightBuckets>();

    for (const bucket of buckets) {
      if (!bucket.campaignId) continue;
      const target = byCampaign.get(bucket.campaignId) ?? {};
      target[bucket.status] = bucket._count._all;
      byCampaign.set(bucket.campaignId, target);
    }

    return {
      campaigns: rows.map((row) => campaignView(row, byCampaign.get(row.id))),
    };
  }

  async detail(claims: AuthClaims, id: string, cursor?: string) {
    const { workspaceId } = await this.workspaces.primaryFor(claims);
    const row = await this.mustCampaign(workspaceId, id);

    const [buckets, page] = await Promise.all([
      this.prisma.message.groupBy({
        by: ["status"],
        where: { campaignId: id },
        _count: { _all: true },
      }),
      this.prisma.campaignRecipient.findMany({
        where: { campaignId: id },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: RECIPIENT_PAGE + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          waId: true,
          status: true,
          errorReason: true,
          contact: { select: { profileName: true, phoneDisplay: true } },
          message: {
            select: {
              status: true,
              sentAt: true,
              deliveredAt: true,
              readAt: true,
            },
          },
        },
      }),
    ]);

    const insights = Object.fromEntries(
      buckets.map((bucket) => [bucket.status, bucket._count._all]),
    ) as InsightBuckets;

    const items = page.slice(0, RECIPIENT_PAGE).map(recipientView);

    return {
      campaign: campaignView(row, insights),
      recipients: {
        items,
        nextCursor:
          page.length > RECIPIENT_PAGE ? (items[items.length - 1]?.id ?? null) : null,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  async create(
    claims: AuthClaims,
    dto: CreateCampaignDto,
  ): Promise<{ campaign: CampaignView }> {
    const { workspaceId, userId } = await this.workspaces.primaryFor(claims);

    const template = await this.prisma.messageTemplate.findFirst({
      where: { id: dto.templateId, workspaceId },
      select: {
        id: true,
        name: true,
        language: true,
        category: true,
        status: true,
        parameterFormat: true,
        components: true,
      },
    });

    if (!template) throw new NotFoundException("That template does not exist.");

    if (template.status !== "APPROVED") {
      throw new ConflictException({
        code: "TEMPLATE_NOT_APPROVED",
        message: `“${template.name}” is not approved by Meta yet, so it cannot be sent.`,
      });
    }

    const shape = shapeOf(template.components);
    const bindings = bindingsOf(dto.variables);
    const buttonUrls = buttonUrlsOf(dto.buttonUrls);

    const problems = [
      ...problemsInBindings(shape.tokens, bindings),
      // The token loop passes because every token has a placeholder; what is
      // left is exactly the URL buttons that still need an address.
      ...problemsIn({
        shape,
        format: template.parameterFormat,
        values: Object.fromEntries(shape.tokens.map((token) => [token, "x"])),
        buttonUrls,
        tapTarget: null,
      }),
    ];

    if (problems.length > 0) {
      throw new BadRequestException({
        code: "TEMPLATE_VARIABLES_INVALID",
        message: problems,
      });
    }

    if (template.category === "MARKETING" && dto.optInConfirmed !== true) {
      throw new BadRequestException({
        code: "OPT_IN_REQUIRED",
        message:
          "Confirm that these contacts agreed to receive marketing messages.",
      });
    }

    const scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : null;

    if (scheduledAt && scheduledAt.getTime() <= Date.now()) {
      throw new BadRequestException({
        code: "SCHEDULE_IN_PAST",
        message: "A schedule has to be in the future.",
      });
    }

    const row = await this.prisma.campaign.create({
      data: {
        workspaceId,
        name: dto.name,
        templateId: template.id,
        templateName: template.name,
        templateLanguage: template.language,
        templateCategory: template.category,
        audienceTags: dto.audienceTags ?? [],
        variables: bindings as unknown as Prisma.InputJsonValue,
        buttonUrls: buttonUrls as Prisma.InputJsonValue,
        optInConfirmed: dto.optInConfirmed ?? false,
        createdByUserId: userId,
        ...(scheduledAt
          ? { scheduledAt, status: "SCHEDULED" as const }
          : {}),
      },
      select: CAMPAIGN_SELECT,
    });

    return { campaign: campaignView(row) };
  }

  async update(
    claims: AuthClaims,
    id: string,
    dto: UpdateCampaignDto,
  ): Promise<{ campaign: CampaignView }> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);
    const current = await this.mustEditable(workspaceId, id);

    const data: Prisma.CampaignUpdateInput = {};
    const shape = shapeOf(current.template.components);

    if (dto.name !== undefined) data.name = dto.name;
    if (dto.audienceTags !== undefined) data.audienceTags = dto.audienceTags;

    if (dto.variables !== undefined) {
      const bindings = bindingsOf(dto.variables);
      const problems = problemsInBindings(shape.tokens, bindings);

      if (problems.length > 0) {
        throw new BadRequestException({
          code: "TEMPLATE_VARIABLES_INVALID",
          message: problems,
        });
      }

      data.variables = bindings as unknown as Prisma.InputJsonValue;
    }

    if (dto.buttonUrls !== undefined) {
      const buttonUrls = buttonUrlsOf(dto.buttonUrls);
      const problems = problemsIn({
        shape,
        format: current.template.parameterFormat,
        values: Object.fromEntries(shape.tokens.map((token) => [token, "x"])),
        buttonUrls,
        tapTarget: null,
      });

      if (problems.length > 0) {
        throw new BadRequestException({
          code: "TEMPLATE_VARIABLES_INVALID",
          message: problems,
        });
      }

      data.buttonUrls = buttonUrls as Prisma.InputJsonValue;
    }

    if (dto.scheduledAt !== undefined) {
      if (dto.scheduledAt === null) {
        data.scheduledAt = null;
        data.status = "DRAFT";
      } else {
        const scheduledAt = new Date(dto.scheduledAt);

        if (scheduledAt.getTime() <= Date.now()) {
          throw new BadRequestException({
            code: "SCHEDULE_IN_PAST",
            message: "A schedule has to be in the future.",
          });
        }

        data.scheduledAt = scheduledAt;
        data.status = "SCHEDULED";
      }
    }

    const row = await this.prisma.campaign.update({
      where: { id },
      data,
      select: CAMPAIGN_SELECT,
    });

    return { campaign: campaignView(row) };
  }

  async remove(claims: AuthClaims, id: string): Promise<{ deleted: true }> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    await this.mustEditable(workspaceId, id);
    await this.prisma.campaign.delete({ where: { id } });

    return { deleted: true };
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async start(claims: AuthClaims, id: string) {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    await this.mustCampaign(workspaceId, id);

    if (!(await this.engine.begin(id))) {
      throw new ConflictException({
        code: "CAMPAIGN_LOCKED",
        message: "This campaign has already started.",
      });
    }

    return this.detail(claims, id);
  }

  async pause(claims: AuthClaims, id: string) {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    await this.mustCampaign(workspaceId, id);

    const paused = await this.prisma.campaign.updateMany({
      where: { id, status: "RUNNING" },
      data: { status: "PAUSED", pausedAt: new Date() },
    });

    if (paused.count === 0) {
      throw new ConflictException({
        code: "CAMPAIGN_LOCKED",
        message: "Only a running campaign can be paused.",
      });
    }

    return this.detail(claims, id);
  }

  async resume(claims: AuthClaims, id: string) {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    await this.mustCampaign(workspaceId, id);

    const resumed = await this.prisma.campaign.updateMany({
      where: { id, status: "PAUSED" },
      data: { status: "RUNNING", pausedAt: null },
    });

    if (resumed.count === 0) {
      throw new ConflictException({
        code: "CAMPAIGN_LOCKED",
        message: "Only a paused campaign can be resumed.",
      });
    }

    return this.detail(claims, id);
  }

  async cancel(claims: AuthClaims, id: string) {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    await this.mustCampaign(workspaceId, id);

    const cancelled = await this.prisma.campaign.updateMany({
      where: {
        id,
        status: { in: ["DRAFT", "SCHEDULED", "RUNNING", "PAUSED"] },
      },
      data: { status: "CANCELLED" },
    });

    if (cancelled.count === 0) {
      throw new ConflictException({
        code: "CAMPAIGN_LOCKED",
        message: "This campaign has already finished.",
      });
    }

    await this.prisma.campaignRecipient.updateMany({
      where: { campaignId: id, status: "PENDING" },
      data: {
        status: "SKIPPED",
        claimedAt: null,
        errorReason: "The campaign was cancelled.",
      },
    });

    // Cancelling settles the tally too, so the list and the report agree with
    // the rows after a campaign is stopped mid-flight.
    const buckets = await this.prisma.campaignRecipient.groupBy({
      by: ["status"],
      where: { campaignId: id },
      _count: { _all: true },
    });

    const countOf = (status: string) =>
      buckets.find((bucket) => bucket.status === status)?._count._all ?? 0;

    await this.prisma.campaign.update({
      where: { id },
      data: {
        totalCount: buckets.reduce((sum, bucket) => sum + bucket._count._all, 0),
        sentCount: countOf("SENT"),
        failedCount: countOf("FAILED"),
        skippedCount: countOf("SKIPPED"),
      },
    });

    return this.detail(claims, id);
  }

  /**
   * One real send to one number. Deliberately writes no recipient and no
   * `campaignId`: a test is not part of the audience, and counting it would
   * make the insight strip overstate the campaign.
   */
  async test(claims: AuthClaims, id: string, dto: TestCampaignDto) {
    const { workspaceId } = await this.workspaces.primaryFor(claims);
    const campaign = await this.mustCampaign(workspaceId, id);
    const account = await this.engine.accountFor(workspaceId);

    if (!account) {
      throw new ConflictException({
        code: "NO_CHANNEL",
        message: "Connect a WhatsApp number before sending a test.",
      });
    }

    const contact = await this.prisma.contact.upsert({
      where: { workspaceId_waId: { workspaceId, waId: dto.to } },
      create: { workspaceId, waId: dto.to, profileName: "Test recipient" },
      update: {},
      select: { id: true, waId: true },
    });

    const { messageId } = await this.deliverer.send({
      campaign,
      recipient: { contactId: contact.id, waId: contact.waId },
      account,
    });

    return { messageId };
  }

  /** The report the PRD asks for, in the shape a spreadsheet opens. */
  async recipientsCsv(claims: AuthClaims, id: string): Promise<string> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    await this.mustCampaign(workspaceId, id);

    const rows = await this.prisma.campaignRecipient.findMany({
      where: { campaignId: id },
      orderBy: { createdAt: "asc" },
      select: {
        waId: true,
        status: true,
        errorReason: true,
        contact: { select: { profileName: true } },
        message: {
          select: { sentAt: true, deliveredAt: true, readAt: true },
        },
      },
    });

    const lines = [
      "wa_id,name,status,error,sent_at,delivered_at,read_at",
      ...rows.map((row) =>
        [
          row.waId,
          row.contact.profileName ?? "",
          row.status,
          row.errorReason ?? "",
          iso(row.message?.sentAt ?? null) ?? "",
          iso(row.message?.deliveredAt ?? null) ?? "",
          iso(row.message?.readAt ?? null) ?? "",
        ]
          .map(csvCell)
          .join(","),
      ),
    ];

    return `${lines.join("\r\n")}\r\n`;
  }

  // -------------------------------------------------------------------------
  // Guards
  // -------------------------------------------------------------------------

  private async mustCampaign(
    workspaceId: string,
    id: string,
  ): Promise<CampaignRow> {
    const row = await this.prisma.campaign.findFirst({
      where: { id, workspaceId },
      select: CAMPAIGN_SELECT,
    });

    if (!row) throw new NotFoundException("That campaign does not exist.");

    return row;
  }

  private async mustEditable(
    workspaceId: string,
    id: string,
  ): Promise<CampaignRow> {
    const row = await this.mustCampaign(workspaceId, id);

    if (row.status !== "DRAFT" && row.status !== "SCHEDULED") {
      throw new ConflictException({
        code: "CAMPAIGN_LOCKED",
        message:
          "A campaign that has started cannot be edited. Pause or cancel it instead.",
      });
    }

    return row;
  }
}

function recipientView(row: {
  id: string;
  waId: string;
  status: string;
  errorReason: string | null;
  contact: { profileName: string | null; phoneDisplay: string | null };
  message: {
    status: string;
    sentAt: Date | null;
    deliveredAt: Date | null;
    readAt: Date | null;
  } | null;
}): RecipientView {
  return {
    id: row.id,
    waId: row.waId,
    contactName: row.contact.profileName ?? row.contact.phoneDisplay,
    status: row.status,
    errorReason: row.errorReason,
    delivery: row.message?.status ?? null,
    sentAt: iso(row.message?.sentAt ?? null),
    deliveredAt: iso(row.message?.deliveredAt ?? null),
    readAt: iso(row.message?.readAt ?? null),
  };
}

/** A quote would break the row; a leading = would be read as a formula. */
function csvCell(value: string): string {
  const text = /^[=+\-@]/.test(value) ? `'${value}` : value;

  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
