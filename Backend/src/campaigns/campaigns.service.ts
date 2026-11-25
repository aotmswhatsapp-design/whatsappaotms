import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AudienceSource, type Prisma } from "@prisma/client";

import type { AuthClaims } from "../auth/auth.types";
import { problemsIn, shapeOf } from "../inbox/template-send";
import { PrismaService } from "../prisma/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { bindingsOf, problemsInBindings } from "./campaign.values";
import { Deliverer } from "./campaigns.delivery";
import { CampaignsEngine } from "./campaigns.engine";
import {
  normaliseRecipients,
  REPORT_SAMPLE,
  type RecipientImportReport,
  type RecipientInput,
} from "./campaigns.recipients";
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
import type { AddRecipientsDto } from "./dto/add-recipients.dto";
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
        // Newest first. A number added to a campaign is appended at the end of
        // the chronological list, so an ascending first page hid it behind
        // "Load more" — the count rose while the table looked unchanged.
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: RECIPIENT_PAGE + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          waId: true,
          status: true,
          errorReason: true,
          contact: {
            select: {
              profileName: true,
              phoneDisplay: true,
              email: true,
              externalId: true,
            },
          },
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
  ): Promise<{ campaign: CampaignView; recipients?: RecipientImportReport }> {
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

    // A list is what the form sends, so its presence picks the source; an old
    // client that sends neither keeps the tag behaviour it was written for.
    const audienceSource =
      dto.audienceSource ??
      ((dto.recipients?.length ?? 0) > 0
        ? AudienceSource.LIST
        : AudienceSource.SEGMENT);

    if (audienceSource === AudienceSource.SEGMENT && (dto.recipients?.length ?? 0) > 0) {
      throw new BadRequestException({
        code: "RECIPIENTS_NOT_FOR_SEGMENT",
        message:
          "A campaign sends to one audience: a list of numbers or the contacts carrying its tags, never both.",
      });
    }

    if (audienceSource === AudienceSource.LIST && (dto.recipients?.length ?? 0) === 0) {
      throw new BadRequestException({
        code: "NO_RECIPIENTS",
        message: "Add at least one phone number to this campaign's list.",
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
        audienceSource,
        // Tags only describe a tag campaign; keeping them on a list campaign
        // would leave two audiences on a row that can only send to one.
        audienceTags:
          audienceSource === AudienceSource.SEGMENT ? (dto.audienceTags ?? []) : [],
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

    if (audienceSource !== AudienceSource.LIST) {
      return { campaign: campaignView(row) };
    }

    // The list is part of the same act: a campaign created without the numbers
    // it was created for is a draft nobody asked for, so a failed import takes
    // the campaign row with it.
    try {
      const recipients = await this.ingest(
        workspaceId,
        row.id,
        dto.recipients ?? [],
      );

      if (recipients.added === 0) {
        throw new BadRequestException({
          code: "NO_VALID_RECIPIENTS",
          message: describeEmptyImport(recipients),
        });
      }

      const saved = await this.mustCampaign(workspaceId, row.id);

      return { campaign: campaignView(saved), recipients };
    } catch (error) {
      await this.prisma.campaign
        .delete({ where: { id: row.id } })
        .catch(() => undefined);
      throw error;
    }
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

    if (dto.audienceSource !== undefined && dto.audienceSource !== current.audienceSource) {
      if (dto.audienceSource === AudienceSource.SEGMENT) {
        const rows = await this.prisma.campaignRecipient.count({
          where: { campaignId: id },
        });

        if (rows > 0) {
          throw new ConflictException({
            code: "AUDIENCE_HAS_RECIPIENTS",
            message:
              "This campaign already has a list of numbers. Remove them before switching it to contact tags.",
          });
        }

        data.audienceTags = dto.audienceTags ?? current.audienceTags;
      } else {
        // A tag list means nothing once the audience is an explicit list.
        data.audienceTags = [];
      }

      data.audienceSource = dto.audienceSource;
    } else if (
      dto.audienceTags !== undefined &&
      current.audienceSource === AudienceSource.SEGMENT
    ) {
      data.audienceTags = dto.audienceTags;
    }

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
  // The recipient list
  // -------------------------------------------------------------------------

  /**
   * Add numbers, by hand or from a spreadsheet.
   *
   * Duplicates are removed here rather than at send time: a number that
   * already has a row would be sent twice, and a message a customer receives
   * twice is a message they report. What was dropped comes back in the report
   * so the screen can say so out loud.
   */
  async addRecipients(
    claims: AuthClaims,
    id: string,
    dto: AddRecipientsDto,
  ): Promise<{ campaign: CampaignView; recipients: RecipientImportReport }> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    await this.mustRecipientList(workspaceId, id);

    const recipients = await this.ingest(workspaceId, id, dto.recipients);
    const saved = await this.mustCampaign(workspaceId, id);

    return { campaign: campaignView(saved), recipients };
  }

  /** A number added by mistake is removed as easily, until the send starts. */
  async removeRecipient(
    claims: AuthClaims,
    id: string,
    recipientId: string,
  ): Promise<{ campaign: CampaignView; recipients: { total: number } }> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    await this.mustRecipientList(workspaceId, id);

    const removed = await this.prisma.campaignRecipient.deleteMany({
      where: { id: recipientId, campaignId: id, status: "PENDING" },
    });

    if (removed.count === 0) {
      throw new NotFoundException(
        "That recipient is not waiting to be sent, so it cannot be removed.",
      );
    }

    const total = await this.syncTotal(id);
    const saved = await this.mustCampaign(workspaceId, id);

    return { campaign: campaignView(saved), recipients: { total } };
  }

  /**
   * Normalise the rows, upsert their contacts, and write one recipient per
   * number. Returns what landed and what did not, because the screen has to be
   * able to say "three duplicates were removed" and mean it.
   */
  private async ingest(
    workspaceId: string,
    campaignId: string,
    rows: RecipientInput[],
  ): Promise<RecipientImportReport> {
    const { entries, duplicates, invalid } = normaliseRecipients(rows);

    const existing = await this.prisma.campaignRecipient.findMany({
      where: { campaignId },
      select: { waId: true },
    });

    const present = new Set(existing.map((row) => row.waId));
    const already = entries.filter((entry) => present.has(entry.waId));
    const fresh = entries.filter((entry) => !present.has(entry.waId));

    const duplicateReport = {
      count: duplicates.count + already.length,
      phones: [
        ...duplicates.phones,
        ...already.map((entry) => entry.waId),
      ].slice(0, REPORT_SAMPLE),
    };

    if (fresh.length === 0) {
      return {
        added: 0,
        total: existing.length,
        duplicates: duplicateReport,
        invalid,
      };
    }

    // One statement whether the number has written to us before or not; the
    // unique key decides, so nothing is read just to be written back.
    await this.prisma.contact.createMany({
      data: fresh.map((entry) => ({
        workspaceId,
        waId: entry.waId,
        profileName: entry.name,
        phoneDisplay: entry.phoneDisplay,
        email: entry.email,
        externalId: entry.externalId,
      })),
      skipDuplicates: true,
    });

    const contacts = await this.prisma.contact.findMany({
      where: { workspaceId, waId: { in: fresh.map((entry) => entry.waId) } },
      select: {
        id: true,
        waId: true,
        profileName: true,
        phoneDisplay: true,
        email: true,
        externalId: true,
      },
    });

    const byWaId = new Map(contacts.map((contact) => [contact.waId, contact]));

    // A known contact keeps what it has: the name came from the customer's own
    // profile, which outranks a spreadsheet column. Only blanks are filled.
    const fills = fresh.flatMap((entry) => {
      const contact = byWaId.get(entry.waId);

      if (!contact) return [];

      const data: Prisma.ContactUpdateInput = {};

      if (!contact.profileName && entry.name) data.profileName = entry.name;
      if (!contact.phoneDisplay && entry.phoneDisplay) {
        data.phoneDisplay = entry.phoneDisplay;
      }
      if (!contact.email && entry.email) data.email = entry.email;
      if (!contact.externalId && entry.externalId) {
        data.externalId = entry.externalId;
      }

      return Object.keys(data).length > 0
        ? [this.prisma.contact.update({ where: { id: contact.id }, data })]
        : [];
    });

    if (fills.length > 0) await this.prisma.$transaction(fills);

    const created = await this.prisma.campaignRecipient.createMany({
      data: fresh.flatMap((entry) => {
        const contact = byWaId.get(entry.waId);

        return contact
          ? [{ campaignId, contactId: contact.id, waId: entry.waId }]
          : [];
      }),
      skipDuplicates: true,
    });

    const total = await this.syncTotal(campaignId);

    return { added: created.count, total, duplicates: duplicateReport, invalid };
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async start(claims: AuthClaims, id: string) {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    const campaign = await this.mustCampaign(workspaceId, id);

    if (campaign.audienceSource === AudienceSource.LIST) {
      const recipients = await this.prisma.campaignRecipient.count({
        where: { campaignId: id },
      });

      if (recipients === 0) {
        throw new BadRequestException({
          code: "NO_RECIPIENTS",
          message:
            "Add at least one phone number to this campaign before starting it.",
        });
      }
    }

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

  /** Only a list campaign carries numbers, and only until it starts. */
  private async mustRecipientList(
    workspaceId: string,
    id: string,
  ): Promise<CampaignRow> {
    const row = await this.mustEditable(workspaceId, id);

    if (row.audienceSource !== AudienceSource.LIST) {
      throw new ConflictException({
        code: "AUDIENCE_IS_SEGMENT",
        message:
          "This campaign sends to the contacts carrying its tags. Edit it and switch the audience to a list to add numbers.",
      });
    }

    return row;
  }

  /** The audience size, written onto the row the list and the report read. */
  private async syncTotal(campaignId: string): Promise<number> {
    const total = await this.prisma.campaignRecipient.count({
      where: { campaignId },
    });

    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: { totalCount: total },
    });

    return total;
  }
}

function recipientView(row: {
  id: string;
  waId: string;
  status: string;
  errorReason: string | null;
  contact: {
    profileName: string | null;
    phoneDisplay: string | null;
    email: string | null;
    externalId: string | null;
  };
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
    email: row.contact.email,
    externalId: row.contact.externalId,
    status: row.status,
    errorReason: row.errorReason,
    delivery: row.message?.status ?? null,
    sentAt: iso(row.message?.sentAt ?? null),
    deliveredAt: iso(row.message?.deliveredAt ?? null),
    readAt: iso(row.message?.readAt ?? null),
  };
}

/** Why an import landed nothing, in the order that helps most. */
function describeEmptyImport(report: RecipientImportReport): string {
  const reasons: string[] = [];

  if (report.duplicates.count > 0) {
    reasons.push(`${report.duplicates.count} already in this campaign`);
  }

  if (report.invalid.count > 0) {
    reasons.push(`${report.invalid.count} without a usable number`);
  }

  return `No new recipient to add${reasons.length > 0 ? ` — ${reasons.join(", ")}` : ""}.`;
}

/** A quote would break the row; a leading = would be read as a formula. */
function csvCell(value: string): string {
  const text = /^[=+\-@]/.test(value) ? `'${value}` : value;

  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
