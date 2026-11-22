import { Injectable } from "@nestjs/common";
import { InboxSender } from "../inbox/inbox.sender";
import { buildMessage, shapeOf } from "../inbox/template-send";
import { PrismaService } from "../prisma/prisma.service";
import { bindingsOf, resolveValues } from "./campaign.values";
import {
  buttonUrlsOf,
  type CampaignRow,
  type SendAccount,
} from "./campaigns.types";

/** Who a send is for: a materialised recipient, or one test address. */
export interface DeliveryTarget {
  contactId: string;
  waId: string;
}

/**
 * One campaign send, in one place.
 *
 * This is the only code that turns a campaign into a Meta call, and it delegates
 * the call itself to `InboxSender.template` so a campaign message and an inbox
 * message are the same row shape, the same wamid handling and the same
 * `unreadCount` behaviour. What differs is only what a campaign must decide:
 * which conversation, and whose name goes into the greeting.
 */
@Injectable()
export class Deliverer {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: InboxSender,
  ) {}

  /**
   * Contact → conversation → template. The conversation is created on demand:
   * a campaign is often the first thing a business ever says to a contact, so
   * there is usually no thread to reuse.
   */
  async send(input: {
    campaign: CampaignRow;
    recipient: DeliveryTarget;
    account: SendAccount;
    /** A test send is not a recipient, so it must not count as one. */
    campaignId?: string;
  }): Promise<{ messageId: string }> {
    const { campaign, recipient, account } = input;

    const contact = await this.prisma.contact.findFirstOrThrow({
      where: { id: recipient.contactId, workspaceId: campaign.workspaceId },
      select: { id: true, profileName: true, waId: true },
    });

    const conversation = await this.prisma.conversation.upsert({
      where: {
        accountId_contactId: { accountId: account.id, contactId: contact.id },
      },
      create: {
        workspaceId: campaign.workspaceId,
        accountId: account.id,
        contactId: contact.id,
      },
      update: {},
      select: { id: true },
    });

    const built = buildMessage({
      shape: shapeOf(campaign.template.components),
      format: campaign.template.parameterFormat,
      values: resolveValues(bindingsOf(campaign.variables), contact),
      buttonUrls: buttonUrlsOf(campaign.buttonUrls),
      tapTarget: null,
    });

    const message = await this.sender.template({
      workspaceId: campaign.workspaceId,
      conversationId: conversation.id,
      waId: contact.waId,
      account,
      name: campaign.templateName,
      language: campaign.templateLanguage,
      components: built.components,
      body: built.body,
      tapTarget: built.tapTarget,
      ...(input.campaignId ? { campaignId: input.campaignId } : {}),
    });

    return { messageId: message.id };
  }
}
