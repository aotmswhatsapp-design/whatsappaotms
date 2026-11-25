import { request, upload } from "@/lib/api/http";

export { ApiError } from "@/lib/api/http";

export type ConversationStatus = "OPEN" | "PENDING" | "CLOSED";
export type MessageDirection = "INBOUND" | "OUTBOUND";
export type MessageKind =
  | "TEXT"
  | "IMAGE"
  | "DOCUMENT"
  | "AUDIO"
  | "VIDEO"
  | "STICKER"
  | "LOCATION"
  | "CONTACTS"
  | "BUTTON"
  | "INTERACTIVE"
  | "TEMPLATE"
  | "REACTION"
  | "UNSUPPORTED";
export type MessageStatus = "QUEUED" | "SENT" | "DELIVERED" | "READ" | "FAILED";

/** The number the inbox is reading and replying from. */
export interface InboxChannel {
  phoneNumberId: string;
  display: string | null;
  verifiedName: string | null;
  source: string;
  live: boolean;
}

export interface InboxSummary {
  channel: InboxChannel | null;
  counts: { open: number; pending: number; closed: number; total: number };
  unread: number;
}

export interface InboxContact {
  id: string;
  waId: string;
  name: string | null;
  phone: string | null;
}

export interface Conversation {
  id: string;
  status: ConversationStatus;
  contact: InboxContact;
  assignedTo: { id: string; name: string | null; email: string } | null;
  /**
   * The agent that answers this thread: the one that answered first, and the
   * only one that may answer again. Null until an agent has replied.
   */
  agent: { id: string; name: string } | null;
  lastMessageAt: string;
  lastMessagePreview: string | null;
  lastInboundAt: string | null;
  unreadCount: number;
  /** False after 24 hours without a customer message; the composer locks. */
  windowOpen: boolean;
  /**
   * Set when the agent stopped answering this thread: a person replied, the
   * agent handed off, or someone turned it off. Null means an agent may
   * answer here.
   */
  aiPausedAt: string | null;
  /** Why, in one word — `human`, `manual`, `handoff`, `no-context`,
      `unavailable`. A tooltip. */
  aiPauseReason: string | null;
}

export interface InboxMessage {
  id: string;
  direction: MessageDirection;
  kind: MessageKind;
  status: MessageStatus;
  body: string | null;
  /**
   * The agent that wrote it, or null for every human and campaign send. The
   * badge reads this and nothing else, so an AI reply is never guessed from
   * its wording.
   */
  agentId: string | null;
  createdAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  errorReason: string | null;
  /** Set on a template send; null on everything else. */
  template: {
    name: string;
    language: string;
    tapTarget: { url: string; title: string } | null;
  } | null;
  media: {
    mime: string | null;
    name: string | null;
    size: number | null;
    available: boolean;
  } | null;
  /**
   * The message this one quotes or reacts to, as a row id. Null when it
   * quotes nothing, or quotes something outside the loaded page.
   */
  quotedMessageId: string | null;
  /** Contents of a location pin or a contact card; null for every other kind. */
  payload: MessagePayload;
}

/** One card from a contact message. */
export interface ContactCardEntry {
  name: string;
  phones: string[];
  emails: string[];
  organization: string | null;
}

type MessagePayload =
  | {
      kind: "location";
      latitude: number;
      longitude: number;
      name: string | null;
      address: string | null;
    }
  | { kind: "contacts"; contacts: ContactCardEntry[] }
  | null;

export interface InboxNote {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string | null };
}

export interface InboxAgent {
  userId: string;
  role: string;
  name: string | null;
  email: string;
  avatarUrl: string | null;
}

export interface ThreadPayload {
  conversation: Conversation;
  messages: InboxMessage[];
  notes: InboxNote[];
}

export interface ConversationFilters {
  search?: string;
  status?: ConversationStatus;
  /** A user id, `me`, or `unassigned`. */
  assignee?: string;
}

/** A fresh, short-lived link for one attachment. */
export interface MediaLink {
  url: string;
  mime: string | null;
  name: string | null;
}

export function fetchSummary(): Promise<InboxSummary> {
  return request<InboxSummary>("/v1/inbox/summary", { method: "GET" });
}

export function fetchConversations(
  filters: ConversationFilters = {},
): Promise<{ conversations: Conversation[] }> {
  const query = new URLSearchParams();

  if (filters.search?.trim()) query.set("search", filters.search.trim());
  if (filters.status) query.set("status", filters.status);
  if (filters.assignee) query.set("assignee", filters.assignee);

  const suffix = query.size > 0 ? `?${query.toString()}` : "";

  return request(`/v1/inbox/conversations${suffix}`, { method: "GET" });
}

export function fetchAgents(): Promise<{ agents: InboxAgent[] }> {
  return request("/v1/inbox/agents", { method: "GET" });
}

export function fetchThread(id: string): Promise<ThreadPayload> {
  return request<ThreadPayload>(`/v1/inbox/conversations/${id}/messages`, {
    method: "GET",
  });
}

export function sendText(
  id: string,
  body: string,
  quotedMessageId?: string | null,
): Promise<{ message: InboxMessage }> {
  return request(`/v1/inbox/conversations/${id}/messages`, {
    method: "POST",
    body: JSON.stringify({
      body,
      ...(quotedMessageId ? { quotedMessageId } : {}),
    }),
  });
}

export function sendMedia(
  id: string,
  file: File,
  caption: string,
  quotedMessageId?: string | null,
): Promise<{ message: InboxMessage }> {
  const form = new FormData();
  form.set("file", file, file.name);
  if (caption.trim()) form.set("caption", caption.trim());
  if (quotedMessageId) form.set("quotedMessageId", quotedMessageId);

  return upload(`/v1/inbox/conversations/${id}/media`, form);
}

/**
 * One emoji on one message. An empty string removes the reaction AOTMS sent
 * before, which is also how a tap on the chip behaves on the customer's phone.
 */
export function sendReaction(
  id: string,
  messageId: string,
  emoji: string,
): Promise<{ message: InboxMessage | null }> {
  return request(`/v1/inbox/conversations/${id}/reactions`, {
    method: "POST",
    body: JSON.stringify({ messageId, emoji }),
  });
}

export interface LocationInput {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

export function sendLocation(
  id: string,
  input: LocationInput,
): Promise<{ message: InboxMessage }> {
  return request(`/v1/inbox/conversations/${id}/locations`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface ContactCardInput {
  name: string;
  phone?: string;
  email?: string;
  organization?: string;
}

export function sendContact(
  id: string,
  input: ContactCardInput,
): Promise<{ message: InboxMessage }> {
  return request(`/v1/inbox/conversations/${id}/contacts`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function fetchMedia(messageId: string): Promise<MediaLink> {
  return request<MediaLink>(`/v1/inbox/messages/${messageId}/media`, {
    method: "GET",
  });
}

/**
 * What the composer needs from a template. The templates screen owns the full
 * row; this is the slice a send reads, declared here so the inbox does not
 * reach into another feature's module.
 */
export interface SendableTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  parameterFormat: "NAMED" | "POSITIONAL";
  status: string;
  components: unknown;
  /** True when a stored sample exists, so the preview can ask for a link. */
  hasMedia: boolean;
}

export function fetchSendableTemplates(): Promise<{
  connected: boolean;
  templates: SendableTemplate[];
}> {
  return request("/v1/templates", { method: "GET" });
}

export interface TemplateSendInput {
  templateId: string;
  /** Token without braces (`1`, `first_name`) → the value to fill in. */
  variables: Record<string, string>;
  /** Button index → the full address that URL button opens. */
  buttonUrls: Record<string, string>;
  tapTarget?: { url: string; title: string };
}

export function sendTemplate(
  conversationId: string,
  input: TemplateSendInput,
): Promise<{ message: InboxMessage }> {
  return request(`/v1/inbox/conversations/${conversationId}/templates`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateConversation(
  id: string,
  patch: {
    status?: ConversationStatus;
    assignedToUserId?: string | null;
  },
): Promise<{ conversation: Conversation }> {
  return request(`/v1/inbox/conversations/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function markRead(id: string): Promise<{ unreadCount: number }> {
  return request(`/v1/inbox/conversations/${id}/read`, { method: "POST" });
}

/**
 * Marks the customer's newest message read and shows "typing…" until the reply
 * goes out. The server picks the message id; a refusal answers 200 with
 * `sent: false`, so callers treat it as fire-and-forget.
 */
export function showTyping(
  id: string,
): Promise<{ sent: boolean; reason: "no-inbound" | "meta" | null }> {
  return request(`/v1/inbox/conversations/${id}/typing`, { method: "POST" });
}

export function addNote(
  id: string,
  body: string,
): Promise<{ note: InboxNote }> {
  return request(`/v1/inbox/conversations/${id}/notes`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export function removeConversation(id: string): Promise<{ deleted: true }> {
  return request(`/v1/inbox/conversations/${id}`, { method: "DELETE" });
}

/**
 * Hands one thread back to the agent. Answers 200 with `paused: false`; the
 * caller applies the change locally and the poll confirms it.
 */
export function resumeAi(
  conversationId: string,
): Promise<{ paused: boolean }> {
  return request(`/v1/inbox/conversations/${conversationId}/ai/resume`, {
    method: "POST",
  });
}
