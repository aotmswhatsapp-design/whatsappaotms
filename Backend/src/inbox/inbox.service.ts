import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { ConversationStatus, Prisma } from "@prisma/client";

import type { AuthClaims } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import type { CreateNoteDto } from "./dto/create-note.dto";
import type { ListConversationsDto } from "./dto/list-conversations.dto";
import type { SendContactDto } from "./dto/send-contact.dto";
import type { SendLocationDto } from "./dto/send-location.dto";
import type { SendMediaDto } from "./dto/send-media.dto";
import type { SendReactionDto } from "./dto/send-reaction.dto";
import type { SendTemplateDto } from "./dto/send-template.dto";
import type { SendTextDto } from "./dto/send-text.dto";
import type { UpdateConversationDto } from "./dto/update-conversation.dto";
import {
  InboxSender,
  type AccountCredentials,
  type Quote,
  type UploadedMedia,
} from "./inbox.sender";
import {
  CONVERSATION_SELECT,
  MESSAGE_SELECT,
  NOTE_SELECT,
  WINDOW_CLOSED_MESSAGE,
  conversationView,
  messageView,
  noteView,
  windowOpen,
  type ConversationSource,
  type ConversationView,
  type MessageView,
  type NoteView,
} from "./inbox.view";
import { MediaStorage } from "./media.storage";
import { buildMessage, problemsIn, shapeOf } from "./template-send";

const SEND_ACCOUNT_SELECT = {
  phoneNumberId: true,
  graphVersion: true,
  accessTokenCipher: true,
} satisfies Prisma.WhatsAppAccountSelect;

export interface ChannelView {
  phoneNumberId: string;
  display: string | null;
  verifiedName: string | null;
  source: string;
  /** Meta's GET handshake landed, so deliveries are being accepted. */
  live: boolean;
}

export interface SummaryPayload {
  channel: ChannelView | null;
  counts: { open: number; pending: number; closed: number; total: number };
  unread: number;
}

export interface AgentView {
  userId: string;
  role: string;
  name: string | null;
  email: string;
  avatarUrl: string | null;
}

export interface ThreadPayload {
  conversation: ConversationView;
  messages: MessageView[];
  notes: NoteView[];
}

/**
 * The inbox's read and management half. Sending lives in `InboxSender`, because
 * a reply travels to Meta while everything here touches only our database.
 *
 * Every method starts from `primaryFor(claims)`: the client never supplies a
 * workspace, so there is no way to ask for another tenant's thread.
 */
@Injectable()
export class InboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly sender: InboxSender,
    private readonly storage: MediaStorage,
  ) {}

  async list(
    claims: AuthClaims,
    query: ListConversationsDto,
  ): Promise<{ conversations: ConversationView[] }> {
    const { workspaceId, userId } = await this.workspaces.primaryFor(claims);

    const where: Prisma.ConversationWhereInput = { workspaceId };

    if (query.status) where.status = query.status;

    const assignee = query.assignee?.trim();

    if (assignee === "me") {
      where.assignedToUserId = userId;
    } else if (assignee === "unassigned") {
      where.assignedToUserId = null;
    } else if (assignee) {
      if (!isUuid(assignee)) {
        throw new BadRequestException("Unknown assignee filter.");
      }

      where.assignedToUserId = assignee;
    }

    const term = query.search?.trim();

    if (term) {
      const digits = term.replace(/\D/g, "");

      where.OR = [
        { contact: { profileName: { contains: term, mode: "insensitive" } } },
        { lastMessagePreview: { contains: term, mode: "insensitive" } },
        ...(digits.length >= 3 ? [{ contact: { waId: { contains: digits } } }] : []),
      ];
    }

    const rows = await this.prisma.conversation.findMany({
      where,
      orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
      take: query.take ?? 50,
      select: CONVERSATION_SELECT,
    });

    return { conversations: rows.map(conversationView) };
  }

  async summary(claims: AuthClaims): Promise<SummaryPayload> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    const [account, grouped, totals] = await Promise.all([
      this.prisma.whatsAppAccount.findUnique({
        where: { workspaceId },
        select: {
          phoneNumberId: true,
          displayPhoneNumber: true,
          verifiedName: true,
          source: true,
          webhookVerifiedAt: true,
        },
      }),
      this.prisma.conversation.groupBy({
        by: ["status"],
        where: { workspaceId },
        _count: { _all: true },
      }),
      this.prisma.conversation.aggregate({
        where: { workspaceId },
        _count: { _all: true },
        _sum: { unreadCount: true },
      }),
    ]);

    const counts: Record<ConversationStatus, number> = {
      OPEN: 0,
      PENDING: 0,
      CLOSED: 0,
    };

    for (const row of grouped) counts[row.status] = row._count._all;

    return {
      channel: account
        ? {
            phoneNumberId: account.phoneNumberId,
            display: account.displayPhoneNumber,
            verifiedName: account.verifiedName,
            source: account.source,
            live: account.webhookVerifiedAt !== null,
          }
        : null,
      counts: {
        open: counts.OPEN,
        pending: counts.PENDING,
        closed: counts.CLOSED,
        total: totals._count._all,
      },
      unread: totals._sum.unreadCount ?? 0,
    };
  }

  async agents(claims: AuthClaims): Promise<{ agents: AgentView[] }> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);
    const rows = await this.workspaces.members(workspaceId);

    return {
      agents: rows.map((row) => ({
        userId: row.user.id,
        role: row.role,
        name: row.user.fullName,
        email: row.user.email,
        avatarUrl: row.user.avatarUrl,
      })),
    };
  }

  async thread(claims: AuthClaims, id: string): Promise<ThreadPayload> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);
    const conversation = await this.mustConversation(workspaceId, id);

    const [messages, notes] = await Promise.all([
      this.prisma.message.findMany({
        where: { conversationId: conversation.id },
        // Newest first for the bound, reversed for display.
        orderBy: { createdAt: "desc" },
        take: 200,
        select: MESSAGE_SELECT,
      }),
      this.prisma.internalNote.findMany({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: "asc" },
        take: 200,
        select: NOTE_SELECT,
      }),
    ]);

    // A quote is drawn from a message the thread already holds, so quotes are
    // resolved to row ids here rather than sending wamids to the client.
    const ordered = messages.reverse();
    const index = new Map<string, string>();

    for (const row of ordered) {
      if (row.wamid) index.set(row.wamid, row.id);
    }

    return {
      conversation: conversationView(conversation),
      messages: ordered.map((row) => messageView(row, index)),
      notes: notes.map(noteView),
    };
  }

  async sendText(
    claims: AuthClaims,
    id: string,
    dto: SendTextDto,
  ): Promise<{ message: MessageView }> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);
    const { conversationId, waId, account } = await this.forSending(workspaceId, id);

    return {
      message: await this.sender.text({
        workspaceId,
        conversationId,
        waId,
        account,
        body: dto.body,
        quote: await this.quoteOf(conversationId, dto.quotedMessageId),
      }),
    };
  }

  async sendMedia(
    claims: AuthClaims,
    id: string,
    file: UploadedMedia,
    dto: SendMediaDto,
  ): Promise<{ message: MessageView }> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);
    const { conversationId, waId, account } = await this.forSending(workspaceId, id);

    return {
      message: await this.sender.media({
        workspaceId,
        conversationId,
        waId,
        account,
        file,
        caption: dto.caption && dto.caption.length > 0 ? dto.caption : null,
        quote: await this.quoteOf(conversationId, dto.quotedMessageId),
      }),
    };
  }

  /**
   * One emoji on one message. Like every other service message it needs an
   * open window, and the target has to be a message Meta already knows.
   */
  async sendReaction(
    claims: AuthClaims,
    id: string,
    dto: SendReactionDto,
  ): Promise<{ message: MessageView | null }> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);
    const { conversationId, waId, account } = await this.forSending(workspaceId, id);
    const target = await this.quoteOf(conversationId, dto.messageId);

    if (!target) {
      throw new BadRequestException("React to a message in this conversation.");
    }

    return {
      message: await this.sender.reaction({
        workspaceId,
        conversationId,
        waId,
        account,
        target,
        emoji: dto.emoji,
      }),
    };
  }

  async sendLocation(
    claims: AuthClaims,
    id: string,
    dto: SendLocationDto,
  ): Promise<{ message: MessageView }> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);
    const { conversationId, waId, account } = await this.forSending(workspaceId, id);

    return {
      message: await this.sender.location({
        workspaceId,
        conversationId,
        waId,
        account,
        latitude: dto.latitude,
        longitude: dto.longitude,
        name: dto.name ?? null,
        address: dto.address ?? null,
      }),
    };
  }

  async sendContact(
    claims: AuthClaims,
    id: string,
    dto: SendContactDto,
  ): Promise<{ message: MessageView }> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);
    const { conversationId, waId, account } = await this.forSending(workspaceId, id);

    return {
      message: await this.sender.contacts({
        workspaceId,
        conversationId,
        waId,
        account,
        contacts: [
          {
            name: dto.name,
            phones: dto.phone ? [dto.phone] : [],
            emails: dto.email ? [dto.email] : [],
            organization: dto.organization ?? null,
          },
        ],
      }),
    };
  }

  async attachment(
    claims: AuthClaims,
    messageId: string,
  ): Promise<{ url: string; mime: string | null; name: string | null }> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    return this.sender.attachment({ workspaceId, messageId });
  }

  /**
   * A template send.
   *
   * Two rules are enforced here and nowhere else: the template has to be
   * approved by Meta, and the variables have to cover what the approved text
   * asks for. The 24-hour window is deliberately absent — a template is the
   * one message WhatsApp lets a business start with.
   */
  async sendTemplate(
    claims: AuthClaims,
    id: string,
    dto: SendTemplateDto,
  ): Promise<{ message: MessageView }> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    const template = await this.prisma.messageTemplate.findFirst({
      where: { id: dto.templateId, workspaceId },
      select: {
        name: true,
        language: true,
        status: true,
        parameterFormat: true,
        components: true,
      },
    });

    if (!template) {
      throw new NotFoundException("That template does not exist.");
    }

    if (template.status !== "APPROVED") {
      throw new ConflictException({
        code: "TEMPLATE_NOT_APPROVED",
        message: `“${template.name}” is ${statusWords(template.status)}. Meta has to approve a template before it can be sent.`,
      });
    }

    const input = {
      shape: shapeOf(template.components),
      format: template.parameterFormat,
      values: dto.variables ?? {},
      buttonUrls: dto.buttonUrls ?? {},
      tapTarget: dto.tapTarget ?? null,
    };

    const problems = problemsIn(input);

    if (problems.length > 0) {
      throw new BadRequestException({
        code: "TEMPLATE_VARIABLES_INVALID",
        message: problems,
      });
    }

    const built = buildMessage(input);
    const { conversationId, waId, account } = await this.forTemplateSending(
      workspaceId,
      id,
    );

    return {
      message: await this.sender.template({
        workspaceId,
        conversationId,
        waId,
        account,
        name: template.name,
        language: template.language,
        components: built.components,
        body: built.body,
        tapTarget: built.tapTarget,
      }),
    };
  }

  async update(
    claims: AuthClaims,
    id: string,
    dto: UpdateConversationDto,
  ): Promise<{ conversation: ConversationView }> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);
    const conversation = await this.mustConversation(workspaceId, id);

    const data: Prisma.ConversationUpdateInput = {};

    if (dto.status) data.status = dto.status;

    if (dto.assignedToUserId !== undefined) {
      if (dto.assignedToUserId === null) {
        data.assignedTo = { disconnect: true };
      } else {
        const member = await this.prisma.workspaceMember.findUnique({
          where: {
            workspaceId_userId: { workspaceId, userId: dto.assignedToUserId },
          },
          select: { userId: true },
        });

        if (!member) {
          throw new BadRequestException(
            "That person is not a member of this workspace.",
          );
        }

        data.assignedTo = { connect: { id: dto.assignedToUserId } };
      }
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException("Nothing to update.");
    }

    const updated = await this.prisma.conversation.update({
      where: { id: conversation.id },
      data,
      select: CONVERSATION_SELECT,
    });

    return { conversation: conversationView(updated) };
  }

  /**
   * Clears the badge and tells Meta the thread was read. A failure to report
   * the read is logged by the sender and never blocks the agent.
   */
  async markRead(
    claims: AuthClaims,
    id: string,
  ): Promise<{ unreadCount: number }> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    const result = await this.prisma.conversation.updateMany({
      where: { id, workspaceId },
      data: { unreadCount: 0 },
    });

    // updateMany counts matched rows, so zero means the thread is not ours.
    if (result.count === 0) {
      throw new NotFoundException("That conversation does not exist.");
    }

    try {
      const target = await this.sendTarget(workspaceId, id);

      await this.sender.read({
        workspaceId,
        conversationId: target.conversationId,
        waId: target.waId,
        account: target.account,
      });
    } catch {
      // No channel connected, or the receipt was refused: the badge is still
      // cleared, which is the half of this that belongs to us.
    }

    return { unreadCount: 0 };
  }

  /**
   * Tells WhatsApp an agent is answering, which also marks the customer's
   * newest message read. The window is not checked: the composer disables
   * itself once it closes, so a call arriving late is already wrong and Meta's
   * refusal is swallowed by the sender.
   */
  async showTyping(
    claims: AuthClaims,
    id: string,
  ): Promise<{ sent: boolean; reason: "no-inbound" | "meta" | null }> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);
    const target = await this.sendTarget(workspaceId, id);

    return this.sender.typing({
      workspaceId,
      conversationId: target.conversationId,
      waId: target.waId,
      account: target.account,
    });
  }

  async addNote(
    claims: AuthClaims,
    id: string,
    dto: CreateNoteDto,
  ): Promise<{ note: NoteView }> {
    const { workspaceId, userId } = await this.workspaces.primaryFor(claims);
    const conversation = await this.mustConversation(workspaceId, id);

    const note = await this.prisma.internalNote.create({
      data: {
        conversationId: conversation.id,
        authorUserId: userId,
        body: dto.body,
      },
      select: NOTE_SELECT,
    });

    return { note: noteView(note) };
  }

  /**
   * Removes the thread, its messages and its notes (cascades), then its stored
   * media. The storage call is best effort: a deletion request must succeed
   * even when Storage is having a bad day.
   */
  async remove(claims: AuthClaims, id: string): Promise<{ deleted: true }> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);
    const conversation = await this.mustConversation(workspaceId, id);

    const stored = await this.prisma.message.findMany({
      where: { conversationId: conversation.id, mediaPath: { not: null } },
      select: { mediaPath: true },
    });

    await this.prisma.conversation.delete({ where: { id: conversation.id } });

    await this.storage.remove(
      stored
        .map((row) => row.mediaPath)
        .filter((path): path is string => Boolean(path)),
    );

    return { deleted: true };
  }

  /**
   * A conversation the caller may act on, plus the credentials and window
   * state a reply needs.
   */
  private async forSending(
    workspaceId: string,
    id: string,
  ): Promise<{
    conversationId: string;
    waId: string;
    account: AccountCredentials;
  }> {
    const target = await this.sendTarget(workspaceId, id);

    if (!target.windowOpen) {
      throw new ConflictException({
        code: "WINDOW_CLOSED",
        message: WINDOW_CLOSED_MESSAGE,
      });
    }

    return target;
  }

  /**
   * The same target, minus the window. A template is exactly the message a
   * business is allowed to send after 24 quiet hours, so checking the window
   * here would refuse the feature's only purpose.
   */
  private async forTemplateSending(
    workspaceId: string,
    id: string,
  ): Promise<{
    conversationId: string;
    waId: string;
    account: AccountCredentials;
  }> {
    return this.sendTarget(workspaceId, id);
  }

  private async sendTarget(
    workspaceId: string,
    id: string,
  ): Promise<{
    conversationId: string;
    waId: string;
    account: AccountCredentials;
    windowOpen: boolean;
  }> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, workspaceId },
      select: {
        id: true,
        lastInboundAt: true,
        contact: { select: { waId: true } },
      },
    });

    if (!conversation) {
      throw new NotFoundException("That conversation does not exist.");
    }

    const account = await this.prisma.whatsAppAccount.findUnique({
      where: { workspaceId },
      select: SEND_ACCOUNT_SELECT,
    });

    if (!account) {
      throw new ConflictException({
        code: "NO_CHANNEL",
        message: "Connect a WhatsApp number before sending messages.",
      });
    }

    return {
      conversationId: conversation.id,
      waId: conversation.contact.waId,
      account,
      windowOpen: windowOpen(conversation.lastInboundAt),
    };
  }

  /**
   * The message behind a quote or a reaction, as both the client (row id) and
   * Meta (wamid) name it. Refuses a row from another conversation, and a row
   * that never reached WhatsApp — Meta cannot quote something it never saw.
   */
  private async quoteOf(
    conversationId: string,
    messageId: string | undefined,
  ): Promise<Quote | null> {
    if (!messageId) return null;

    const row = await this.prisma.message.findFirst({
      where: { id: messageId, conversationId },
      select: { id: true, wamid: true },
    });

    if (!row) {
      throw new NotFoundException("The message you are quoting is not in this conversation.");
    }

    if (!row.wamid) {
      throw new ConflictException({
        code: "QUOTE_NOT_SENT",
        message: "That message has not reached WhatsApp yet, so it cannot be quoted.",
      });
    }

    return { id: row.id, wamid: row.wamid };
  }

  private async mustConversation(
    workspaceId: string,
    id: string,
  ): Promise<ConversationSource> {
    const row = await this.prisma.conversation.findFirst({
      where: { id, workspaceId },
      select: CONVERSATION_SELECT,
    });

    if (!row) {
      throw new NotFoundException("That conversation does not exist.");
    }

    return row;
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

/** Meta's review states in the sentence a sender can act on. */
const STATUS_WORDS: Record<string, string> = {
  PENDING: "still in review",
  REJECTED: "rejected",
  PAUSED: "paused",
  DISABLED: "disabled",
  FLAGGED: "flagged",
  PENDING_DELETION: "pending deletion",
  DELETED: "deleted",
  IN_APPEAL: "in appeal",
};

function statusWords(status: string): string {
  return STATUS_WORDS[status] ?? status.toLowerCase().replace(/_/g, " ");
}
