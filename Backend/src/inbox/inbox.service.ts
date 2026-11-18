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
import type { UpdateConversationDto } from "./dto/update-conversation.dto";
import {
  InboxSender,
  type AccountCredentials,
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

    return {
      conversation: conversationView(conversation),
      messages: messages.reverse().map(messageView),
      notes: notes.map(noteView),
    };
  }

  async sendText(
    claims: AuthClaims,
    id: string,
    body: string,
  ): Promise<{ message: MessageView }> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);
    const { conversationId, waId, account } = await this.forSending(workspaceId, id);

    return {
      message: await this.sender.text({
        workspaceId,
        conversationId,
        waId,
        account,
        body,
      }),
    };
  }

  async sendMedia(
    claims: AuthClaims,
    id: string,
    file: UploadedMedia,
    caption: string | null,
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
        caption: caption && caption.length > 0 ? caption : null,
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

    return { unreadCount: 0 };
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

    if (!windowOpen(conversation.lastInboundAt)) {
      throw new ConflictException({
        code: "WINDOW_CLOSED",
        message: WINDOW_CLOSED_MESSAGE,
      });
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
    };
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
