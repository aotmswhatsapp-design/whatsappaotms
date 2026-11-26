import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Throttle } from "@nestjs/throttler";

import type { AuthClaims } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";
import { CreateNoteDto } from "./dto/create-note.dto";
import { ListConversationsDto } from "./dto/list-conversations.dto";
import { SendCardDto } from "./dto/send-card.dto";
import { SendContactDto } from "./dto/send-contact.dto";
import { SendLocationDto } from "./dto/send-location.dto";
import { SendMediaDto } from "./dto/send-media.dto";
import { SendReactionDto } from "./dto/send-reaction.dto";
import { SendTemplateDto } from "./dto/send-template.dto";
import { SendTextDto } from "./dto/send-text.dto";
import { UpdateConversationDto } from "./dto/update-conversation.dto";
import { MAX_MEDIA_BYTES, type UploadedMedia } from "./inbox.sender";
import { InboxService } from "./inbox.service";

/**
 * The inbox's HTTP surface. Every route resolves its workspace from the token,
 * so a conversation id from another tenant answers 404 exactly like a missing
 * one.
 */
@Controller("v1/inbox")
@UseGuards(SupabaseAuthGuard)
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  /** GET /api/v1/inbox/conversations — the queue, newest activity first. */
  @Get("conversations")
  list(@CurrentUser() claims: AuthClaims, @Query() query: ListConversationsDto) {
    return this.inbox.list(claims, query);
  }

  /**
   * GET /api/v1/inbox/summary — counters for the header, and whether a number
   * exists. A null channel is what turns the page into "connect a number".
   */
  @Get("summary")
  summary(@CurrentUser() claims: AuthClaims) {
    return this.inbox.summary(claims);
  }

  /** GET /api/v1/inbox/agents — who a conversation can be assigned to. */
  @Get("agents")
  agents(@CurrentUser() claims: AuthClaims) {
    return this.inbox.agents(claims);
  }

  /** GET /api/v1/inbox/conversations/:id/messages — messages plus notes. */
  @Get("conversations/:id/messages")
  thread(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.inbox.thread(claims, id);
  }

  /**
   * POST /api/v1/inbox/conversations/:id/messages — a text reply.
   *
   * 409 with `WINDOW_CLOSED` when the customer has not written for 24 hours:
   * WhatsApp's rule, and the composer disables itself from the same signal.
   * An optional `quotedMessageId` puts the reply on that message.
   */
  @Post("conversations/:id/messages")
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  sendText(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: SendTextDto,
  ) {
    return this.inbox.sendText(claims, id, dto);
  }

  /**
   * POST /api/v1/inbox/conversations/:id/cards — a card: picture, information,
   * buttons.
   *
   * The flow travels in the body because cards have no table yet. Which shape
   * the ladder picks is not the caller's problem: three choices become buttons,
   * ten become a list, and more become numbered text that the same router reads
   * back.
   */
  @Post("conversations/:id/cards")
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  sendCard(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: SendCardDto,
  ) {
    return this.inbox.sendCard(claims, id, dto);
  }

  /**
   * POST /api/v1/inbox/conversations/:id/media — multipart, field `file`, with
   * an optional `caption`. The size limit is enforced here and again in the
   * sender, so a direct API caller cannot skip it.
   */
  @Post("conversations/:id/media")
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: MAX_MEDIA_BYTES } }),
  )
  sendMedia(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedMedia | undefined,
    @Body() dto: SendMediaDto,
  ) {
    if (!file) {
      // Without this the request would reach the sender with an empty buffer.
      throw new BadRequestException("Attach a file to send.");
    }

    return this.inbox.sendMedia(claims, id, file, dto);
  }

  /**
   * POST /api/v1/inbox/conversations/:id/reactions — one emoji on one message.
   *
   * `emoji: ""` removes the reaction we sent before, the way a tap on the chip
   * does on the customer's phone.
   */
  @Post("conversations/:id/reactions")
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  sendReaction(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: SendReactionDto,
  ) {
    return this.inbox.sendReaction(claims, id, dto);
  }

  /** POST /api/v1/inbox/conversations/:id/locations — a location pin. */
  @Post("conversations/:id/locations")
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  sendLocation(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: SendLocationDto,
  ) {
    return this.inbox.sendLocation(claims, id, dto);
  }

  /** POST /api/v1/inbox/conversations/:id/contacts — a contact card. */
  @Post("conversations/:id/contacts")
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  sendContact(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: SendContactDto,
  ) {
    return this.inbox.sendContact(claims, id, dto);
  }

  /**
   * POST /api/v1/inbox/conversations/:id/templates — an approved template.
   *
   * Deliberately not gated on the 24-hour window: a template is the message
   * Meta lets a business use to reopen a conversation. The service refuses an
   * unapproved template, and Meta answers with its own sentence when the
   * payload is wrong.
   */
  @Post("conversations/:id/templates")
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  sendTemplate(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: SendTemplateDto,
  ) {
    return this.inbox.sendTemplate(claims, id, dto);
  }

  /** GET /api/v1/inbox/messages/:id/media — a 5-minute signed download URL. */
  @Get("messages/:id/media")
  media(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.inbox.attachment(claims, id);
  }

  /**
   * DELETE /api/v1/inbox/messages/:id — hides one bubble from the inbox.
   *
   * Local only. WhatsApp has no way to remove a message the customer already
   * received, so this answers 200 without claiming the message is gone.
   */
  @Delete("messages/:id")
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  hideMessage(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.inbox.hideMessage(claims, id);
  }

  /** PATCH /api/v1/inbox/conversations/:id — status and assignment. */
  @Patch("conversations/:id")
  update(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateConversationDto,
  ) {
    return this.inbox.update(claims, id, dto);
  }

  /** POST /api/v1/inbox/conversations/:id/read — clears the unread badge. */
  @Post("conversations/:id/read")
  @HttpCode(200)
  markRead(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.inbox.markRead(claims, id);
  }

  /**
   * POST /api/v1/inbox/conversations/:id/typing — read receipt plus the
   * "typing…" bubble. Answers 200 even when Meta refuses: it is cosmetic and
   * must never interrupt the agent's draft.
   */
  @Post("conversations/:id/typing")
  @HttpCode(200)
  showTyping(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.inbox.showTyping(claims, id);
  }

  /** POST /api/v1/inbox/conversations/:id/notes — an internal note. */
  @Post("conversations/:id/notes")
  addNote(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CreateNoteDto,
  ) {
    return this.inbox.addNote(claims, id, dto);
  }

  /** DELETE /api/v1/inbox/conversations/:id — purges the thread and media. */
  @Delete("conversations/:id")
  remove(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.inbox.remove(claims, id);
  }
}
