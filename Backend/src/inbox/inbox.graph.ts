import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { MessageKind } from "@prisma/client";

import {
  MetaRequestError,
  MetaShapeError,
  MetaTransportError,
  type MetaErrorBody,
} from "../whatsapp/meta-graph";

/** Uploads and downloads of customer files need more room than a lookup. */
const TIMEOUT_MS = 30_000;

const SENDABLE: Partial<Record<MessageKind, string>> = {
  IMAGE: "image",
  DOCUMENT: "document",
  AUDIO: "audio",
  VIDEO: "video",
  STICKER: "sticker",
};

interface SendResponse {
  messages?: { id?: string }[];
}

/** One card out of a contact message we send. */
export interface ContactCardInput {
  name: string;
  phones: string[];
  emails: string[];
  organization: string | null;
}

/** Meta quotes by wamid; a reply with nothing to quote carries no `context`. */
function contextOf(wamid: string | null): { context?: { message_id: string } } {
  return wamid ? { context: { message_id: wamid } } : {};
}

interface MediaNode {
  url?: string;
  mime_type?: string;
  file_size?: number;
}

/**
 * The Graph calls the inbox needs on top of the connection checks: send, and
 * the two-step media download.
 *
 * Mirrors `MetaGraph`'s error classes on purpose, so the controller can answer
 * a Meta rejection with Meta's own sentence instead of a 500.
 */
@Injectable()
export class InboxGraph {
  private readonly base: string;

  constructor(config: ConfigService) {
    this.base = (
      config.get<string>("META_GRAPH_BASE_URL") ?? "https://graph.facebook.com"
    ).replace(/\/+$/, "");
  }

  async sendText(input: {
    version: string;
    token: string;
    phoneNumberId: string;
    to: string;
    body: string;
    /** The message this reply quotes, when the agent answered one. */
    contextWamid: string | null;
  }): Promise<string> {
    const payload = await this.request<SendResponse>(
      this.messagesUrl(input.version, input.phoneNumberId),
      {
        method: "POST",
        token: input.token,
        json: {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: input.to,
          type: "text",
          text: { body: input.body, preview_url: false },
          ...contextOf(input.contextWamid),
        },
      },
    );

    return wamidOf(payload);
  }

  /**
   * A template message. The components are already in Meta's send shape, so
   * this only wraps them: the same rules that built them at creation decide
   * what a customer sees.
   */
  async sendTemplate(input: {
    version: string;
    token: string;
    phoneNumberId: string;
    to: string;
    name: string;
    language: string;
    components: unknown[];
  }): Promise<string> {
    const payload = await this.request<SendResponse>(
      this.messagesUrl(input.version, input.phoneNumberId),
      {
        method: "POST",
        token: input.token,
        json: {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: input.to,
          type: "template",
          template: {
            name: input.name,
            language: { code: input.language },
            components: input.components,
          },
        },
      },
    );

    return wamidOf(payload);
  }

  /** Media must exist at Meta before a message can reference it. */
  async uploadMedia(input: {
    version: string;
    token: string;
    phoneNumberId: string;
    bytes: Buffer;
    mime: string;
    fileName: string;
  }): Promise<string> {
    const form = new FormData();
    form.set("messaging_product", "whatsapp");
    form.set("type", input.mime);
    form.set(
      "file",
      new Blob([new Uint8Array(input.bytes)], { type: input.mime }),
      input.fileName,
    );

    const url = new URL(
      `${this.base}/${encodeURIComponent(input.version)}/${encodeURIComponent(input.phoneNumberId)}/media`,
    );

    const payload = await this.request<{ id?: string }>(url, {
      method: "POST",
      token: input.token,
      form,
    });

    if (!payload.id) {
      throw new MetaShapeError("Meta accepted the upload but returned no media id.");
    }

    return payload.id;
  }

  async sendMedia(input: {
    version: string;
    token: string;
    phoneNumberId: string;
    to: string;
    kind: MessageKind;
    mediaId: string;
    caption: string | null;
    fileName: string | null;
    contextWamid: string | null;
  }): Promise<string> {
    const type = SENDABLE[input.kind];

    if (!type) {
      throw new MetaShapeError("This message type cannot be sent to WhatsApp.");
    }

    const payload = await this.request<SendResponse>(
      this.messagesUrl(input.version, input.phoneNumberId),
      {
        method: "POST",
        token: input.token,
        json: {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: input.to,
          type,
          [type]: {
            id: input.mediaId,
            ...(input.caption ? { caption: input.caption } : {}),
            ...(type === "document" && input.fileName
              ? { filename: input.fileName }
              : {}),
          },
          ...contextOf(input.contextWamid),
        },
      },
    );

    return wamidOf(payload);
  }

  /**
   * One emoji on one message. An empty string removes a reaction — that is
   * Meta's own convention, not ours, which is why it is passed through rather
   * than refused here.
   */
  async sendReaction(input: {
    version: string;
    token: string;
    phoneNumberId: string;
    to: string;
    messageId: string;
    emoji: string;
  }): Promise<string> {
    const payload = await this.request<SendResponse>(
      this.messagesUrl(input.version, input.phoneNumberId),
      {
        method: "POST",
        token: input.token,
        json: {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: input.to,
          type: "reaction",
          reaction: { message_id: input.messageId, emoji: input.emoji },
        },
      },
    );

    return wamidOf(payload);
  }

  async sendLocation(input: {
    version: string;
    token: string;
    phoneNumberId: string;
    to: string;
    latitude: number;
    longitude: number;
    name: string | null;
    address: string | null;
  }): Promise<string> {
    const payload = await this.request<SendResponse>(
      this.messagesUrl(input.version, input.phoneNumberId),
      {
        method: "POST",
        token: input.token,
        json: {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: input.to,
          type: "location",
          location: {
            latitude: input.latitude,
            longitude: input.longitude,
            ...(input.name ? { name: input.name } : {}),
            ...(input.address ? { address: input.address } : {}),
          },
        },
      },
    );

    return wamidOf(payload);
  }

  /** Contact cards: at most one name, one phone and one email per card we send. */
  async sendContacts(input: {
    version: string;
    token: string;
    phoneNumberId: string;
    to: string;
    contacts: ContactCardInput[];
  }): Promise<string> {
    const payload = await this.request<SendResponse>(
      this.messagesUrl(input.version, input.phoneNumberId),
      {
        method: "POST",
        token: input.token,
        json: {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: input.to,
          type: "contacts",
          contacts: input.contacts.map((card) => ({
            name: { formatted_name: card.name },
            ...(card.phones.length > 0
              ? { phones: card.phones.map((phone) => ({ phone })) }
              : {}),
            ...(card.emails.length > 0
              ? { emails: card.emails.map((email) => ({ email })) }
              : {}),
            ...(card.organization ? { org: { company: card.organization } } : {}),
          })),
        },
      },
    );

    return wamidOf(payload);
  }

  /**
   * The blue ticks on their own. The composer couples this with "typing…",
   * but opening a thread is a read too — and a customer who is never shown a
   * receipt assumes nobody looked.
   */
  async markRead(input: {
    version: string;
    token: string;
    phoneNumberId: string;
    messageId: string;
  }): Promise<void> {
    await this.request<{ success?: boolean }>(
      this.messagesUrl(input.version, input.phoneNumberId),
      {
        method: "POST",
        token: input.token,
        json: {
          messaging_product: "whatsapp",
          status: "read",
          message_id: input.messageId,
        },
      },
    );
  }

  /**
   * Marks the customer's newest message read and shows "typing…" while we
   * write the answer. Meta couples the two in one call, so the customer also
   * gets the blue ticks that a database-only `markRead` never sent.
   *
   * Meta dismisses the bubble when we reply or after 25 seconds; sending it
   * for a conversation nobody is answering would be a lie, which is why the
   * caller fires this from the composer rather than on thread open.
   */
  async markReadAndTyping(input: {
    version: string;
    token: string;
    phoneNumberId: string;
    messageId: string;
  }): Promise<void> {
    await this.request<{ success?: boolean }>(
      this.messagesUrl(input.version, input.phoneNumberId),
      {
        method: "POST",
        token: input.token,
        json: {
          messaging_product: "whatsapp",
          status: "read",
          message_id: input.messageId,
          typing_indicator: { type: "text" },
        },
      },
    );
  }

  /**
   * Two requests: the media node answers a short-lived URL, and that URL — on
   * a different host — still requires the same bearer token.
   */
  async fetchMedia(input: {
    version: string;
    token: string;
    mediaId: string;
  }): Promise<{ bytes: Buffer; mime: string | null }> {
    const url = new URL(
      `${this.base}/${encodeURIComponent(input.version)}/${encodeURIComponent(input.mediaId)}`,
    );

    const node = await this.request<MediaNode>(url, {
      method: "GET",
      token: input.token,
    });

    if (!node.url) {
      throw new MetaShapeError("Meta returned no download URL for this file.");
    }

    let response: Response;

    try {
      response = await fetch(node.url, {
        headers: { authorization: `Bearer ${input.token}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new MetaTransportError(
        error instanceof Error ? error.message : "media download failed",
      );
    }

    if (!response.ok) {
      throw new MetaRequestError(response.status, {
        message: `Meta refused the media download (HTTP ${response.status}). The file is older than Meta keeps it.`,
      });
    }

    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      mime: node.mime_type ?? null,
    };
  }

  private messagesUrl(version: string, phoneNumberId: string): URL {
    return new URL(
      `${this.base}/${encodeURIComponent(version)}/${encodeURIComponent(phoneNumberId)}/messages`,
    );
  }

  private async request<T>(
    url: URL,
    init: { method: "GET" | "POST"; token: string; json?: unknown; form?: FormData },
  ): Promise<T> {
    const headers: Record<string, string> = {
      accept: "application/json",
      authorization: `Bearer ${init.token}`,
    };

    let body: string | FormData | undefined;

    if (init.form) {
      // Never set content-type here: fetch has to add the multipart boundary.
      body = init.form;
    } else if (init.json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(init.json);
    }

    let response: Response;

    try {
      response = await fetch(url, {
        method: init.method,
        headers,
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      const reason =
        error instanceof Error && error.name === "TimeoutError"
          ? `no answer within ${TIMEOUT_MS / 1000}s`
          : error instanceof Error
            ? error.message
            : "unknown network failure";
      throw new MetaTransportError(reason);
    }

    const text = await response.text();
    const payload = parseJson(text);

    if (!response.ok) {
      // Keep Meta's whole error body, not just its sentence: `code` is what the
      // sender classifies on (131047 means the 24-hour window closed between
      // page load and send), and `fbtrace_id` is what Meta support asks for.
      const body = (payload as { error?: MetaErrorBody } | null)?.error;

      throw new MetaRequestError(
        response.status,
        body ?? { message: text.slice(0, 200) || response.statusText },
      );
    }

    if (!payload) {
      throw new MetaTransportError("Meta returned a body that is not JSON");
    }

    return payload as T;
  }
}

function wamidOf(payload: SendResponse): string {
  const id = payload.messages?.[0]?.id;

  if (!id) {
    throw new MetaShapeError("Meta accepted the message but returned no id.");
  }

  return id;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
