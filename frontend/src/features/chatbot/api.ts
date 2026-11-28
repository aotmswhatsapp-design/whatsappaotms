import { request, upload } from "@/lib/api/http";
import type { BotFlow, BotView, CardFileKind } from "@/lib/bots/card";

export { ApiError } from "@/lib/api/http";

/**
 * The slice of an agent the builder needs to pick one. Declared here rather
 * than imported from the AI feature so this screen does not depend on a module
 * that may move.
 */
export interface BotAgent {
  id: string;
  name: string;
  isActive: boolean;
}

/** Every agent in the workspace, in the order the API lists them. */
export function fetchAgents(): Promise<{ agents: BotAgent[] }> {
  return request("/v1/agents", { method: "GET" });
}

/**
 * One flow. Reading is open to every member; `stored` is false until an owner
 * has saved it, and the flow then comes back empty but already keyed to this
 * agent.
 *
 * Answers 503 `BOT_STORE_MISSING` while the proposal has not been applied —
 * that is an install instruction, not a failure.
 */
export function fetchBot(agentId: string): Promise<BotView> {
  return request<BotView>(`/v1/agents/${agentId}/bot`, { method: "GET" });
}

/** Replaces the whole flow. The server validates it as one object. */
export function saveBot(agentId: string, flow: BotFlow): Promise<BotView> {
  return request<BotView>(`/v1/agents/${agentId}/bot`, {
    method: "PUT",
    body: JSON.stringify({ flow }),
  });
}

/** Whether the shifted cards leave this bot or are copied out of it. */
export type ShiftMode = "move" | "copy";

/** What a shift had to give way so that both flows stayed valid. */
export interface ShiftRepairs {
  /** Buttons left behind that now hand off to a person. */
  sourceButtons: number;
  /** Keyword rules dropped because the card they replied with left the bot. */
  sourceRules: number;
  /** Buttons on the shifted cards that now hand off, their card staying here. */
  targetButtons: number;
}

/** What a shift answers with: this agent's flow, as it is stored now. */
export interface ShiftResult {
  flow: BotFlow;
  targetAgentId: string;
  repairs: ShiftRepairs;
}

/**
 * Carries cards into another agent's bot, on the server.
 *
 * Not two `saveBot` calls: the other agent's flow is read by the API at the
 * moment of the shift, so this screen never has to hold a copy of somebody
 * else's whole bot in order to write one card into it. Both agents are in this
 * workspace — any other is answered as not existing.
 */
export function shiftBot(
  agentId: string,
  input: { targetAgentId: string; cardIds: string[]; mode: ShiftMode },
): Promise<ShiftResult> {
  return request<ShiftResult>(`/v1/agents/${agentId}/bot/shift`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** One upload a card can use, with the address Meta will fetch. */
export interface CardImage {
  url: string;
  path: string;
}

/** What a picture upload adds: the optimised dimensions, for the thumbnail's label. */
export interface UploadedCardImage extends CardImage {
  width: number | null;
  height: number | null;
}

/** One stored document or video, as a card records it. */
export interface CardFileUpload extends CardImage {
  /** The name the customer's phone shows on the download. */
  name: string;
  kind: CardFileKind;
}

/**
 * What one upload answers with.
 *
 * `type` rather than `kind`: the screen has to tell "a picture" from "a file"
 * before it decides which part of the card it belongs to, and `kind` is
 * already taken by a file's own document-or-video.
 */
export type UploadedCardMedia =
  | ({ type: "image" } & UploadedCardImage)
  | ({ type: "file" } & CardFileUpload);

/** Everything already uploaded for this agent, newest first. */
export interface CardMediaLibrary {
  images: (CardImage & { updatedAt: string | null })[];
  files: (CardFileUpload & { updatedAt: string | null })[];
}

/** The pictures and files already stored for this agent, newest first. */
export function fetchCardMedia(agentId: string): Promise<CardMediaLibrary> {
  return request(`/v1/agents/${agentId}/bot/media`, { method: "GET" });
}

/**
 * Stores one upload and answers its permanent address.
 *
 * A picture is validated and re-encoded (rotated, resized to 1080 px, JPEG), so
 * what comes back is already the file every customer will receive. A PDF,
 * Office file or video is stored byte for byte — re-encoding it would break
 * the customer's download.
 *
 * Content type is left to the browser: setting it by hand drops the multipart
 * boundary `fetch` generated.
 */
export function uploadCardMedia(
  agentId: string,
  file: File,
): Promise<UploadedCardMedia> {
  const form = new FormData();

  form.append("file", file);

  return upload<UploadedCardMedia>(`/v1/agents/${agentId}/bot/media`, form);
}

/**
 * Deletes one upload from Supabase, for good.
 *
 * Owner-only. The server refuses while a saved card still points at the upload
 * (409 `BOT_MEDIA_IN_USE`) and for a path that is not this agent's
 * (400 `BOT_MEDIA_UNKNOWN`); both carry a sentence meant for the screen.
 */
export function removeCardMedia(
  agentId: string,
  path: string,
): Promise<{ removed: boolean }> {
  return request(
    `/v1/agents/${agentId}/bot/media?path=${encodeURIComponent(path)}`,
    { method: "DELETE" },
  );
}
