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
  lastMessageAt: string;
  lastMessagePreview: string | null;
  lastInboundAt: string | null;
  unreadCount: number;
  /** False after 24 hours without a customer message; the composer locks. */
  windowOpen: boolean;
}

export interface InboxMessage {
  id: string;
  direction: MessageDirection;
  kind: MessageKind;
  status: MessageStatus;
  body: string | null;
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
}

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
): Promise<{ message: InboxMessage }> {
  return request(`/v1/inbox/conversations/${id}/messages`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export function sendMedia(
  id: string,
  file: File,
  caption: string,
): Promise<{ message: InboxMessage }> {
  const form = new FormData();
  form.set("file", file, file.name);
  if (caption.trim()) form.set("caption", caption.trim());

  return upload(`/v1/inbox/conversations/${id}/media`, form);
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
