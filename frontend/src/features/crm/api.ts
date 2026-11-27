import { request } from "@/lib/api/http";

export { ApiError } from "@/lib/api/http";

/**
 * The CRM's own vocabulary.
 *
 * `Lead` repeats the shopfront and assignment fields the board draws instead
 * of extending the inbox's `Conversation`. The inbox may render a CRM surface
 * (Task 12 mounts the stage chip and the follow-up strip in the thread), but
 * the CRM never reaches back into the inbox: a type import is still a
 * dependency, and one direction is what keeps these two features apart.
 */
export type LeadInterest = "UNKNOWN" | "INTERESTED" | "NOT_INTERESTED";
export type FollowUpStatus = "OPEN" | "DONE" | "CANCELLED";
export type BoardColumn = "NEW" | "INTERESTED" | "FOLLOW_UP" | "NOT_INTERESTED";

/** The order the stage pickers offer, and the filter menu in Task 12. */
export const INTEREST_VALUES: readonly LeadInterest[] = [
  "UNKNOWN",
  "INTERESTED",
  "NOT_INTERESTED",
];

export const INTEREST_LABELS: Record<LeadInterest, string> = {
  UNKNOWN: "New",
  INTERESTED: "Interested",
  NOT_INTERESTED: "Not interested",
};

/** The follow-up a conversation carries, as the inbox also embeds it. */
export interface FollowUpTaskRef {
  id: string;
  title: string;
  dueAt: string | null;
  status: FollowUpStatus;
}

export interface FollowUpTask extends FollowUpTaskRef {
  note: string | null;
  completedAt: string | null;
  /** True once the deadline has passed and the task is still open. */
  overdue: boolean;
  conversationId: string;
  contact: { id: string; name: string | null; waId: string } | null;
  assignedTo: { id: string; name: string | null } | null;
}

/** One conversation on the board. */
export interface Lead {
  id: string;
  status: "OPEN" | "PENDING" | "CLOSED";
  contact: { id: string; waId: string; name: string | null };
  assignedTo: { id: string; name: string | null } | null;
  lastMessageAt: string;
  lastMessagePreview: string | null;
  unreadCount: number;
  interest: LeadInterest;
  /** The deciding message's evidence, so a manual stage shows none. */
  interestScore: number | null;
  interestReason: string | null;
  interestAt: string | null;
  openTask: FollowUpTaskRef | null;
}

export interface PipelineView {
  columns: { key: BoardColumn; label: string; rows: Lead[] }[];
  counts: Record<BoardColumn, number>;
  total: number;
}

export interface CrmSettings {
  /** What the owner stored; null means "not chosen". */
  leadDesignation: string | null;
  /** What rotation actually uses, including the single-designation fallback. */
  effectiveDesignation: string | null;
  autoAssign: boolean;
  autoTask: boolean;
  taskDueHours: number;
  designations: string[];
}

/**
 * The board. `interest` mirrors the route's own filter; the board itself draws
 * every column, so it never passes one.
 */
export function fetchPipeline(interest?: LeadInterest): Promise<PipelineView> {
  const suffix = interest ? `?interest=${interest}` : "";

  return request<PipelineView>(`/v1/crm/pipeline${suffix}`, { method: "GET" });
}

export function setInterest(
  conversationId: string,
  interest: LeadInterest,
): Promise<{ ok: true }> {
  return request<{ ok: true }>(
    `/v1/crm/conversations/${encodeURIComponent(conversationId)}/interest`,
    { method: "PUT", body: JSON.stringify({ interest }) },
  );
}

/**
 * A manager's own errand on a lead, from the board. The server derives the
 * title, the reason and the deadline. 409 `TASK_EXISTS` when the thread
 * already owes one.
 */
export function createTask(conversationId: string): Promise<{ ok: true }> {
  return request<{ ok: true }>(
    `/v1/crm/conversations/${encodeURIComponent(conversationId)}/tasks`,
    { method: "POST" },
  );
}

export function fetchTasks(
  scope: "mine" | "all" = "mine",
): Promise<{ tasks: FollowUpTask[] }> {
  return request<{ tasks: FollowUpTask[] }>(`/v1/crm/tasks?scope=${scope}`, {
    method: "GET",
  });
}

export function updateTask(
  id: string,
  patch: { status?: FollowUpStatus; dueAt?: string | null },
): Promise<{ task: FollowUpTask }> {
  return request<{ task: FollowUpTask }>(
    `/v1/crm/tasks/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(patch) },
  );
}

/** The member's own WhatsApp link. 409 `NO_PERSONAL_NUMBER` when unset. */
export function taskWhatsApp(id: string): Promise<{ url: string; text: string }> {
  return request<{ url: string; text: string }>(
    `/v1/crm/tasks/${encodeURIComponent(id)}/wa-link`,
    { method: "POST" },
  );
}

export function fetchCrmSettings(): Promise<CrmSettings> {
  return request<CrmSettings>("/v1/crm/settings", { method: "GET" });
}

export function saveCrmSettings(
  patch: Partial<
    Pick<CrmSettings, "leadDesignation" | "autoAssign" | "autoTask" | "taskDueHours">
  >,
): Promise<CrmSettings> {
  return request<CrmSettings>("/v1/crm/settings", {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}
