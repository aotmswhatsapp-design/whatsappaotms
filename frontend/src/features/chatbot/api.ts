import { request, upload } from "@/lib/api/http";
import type { BotFlow, BotView } from "@/lib/bots/card";

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

/** One picture a card can use, with the address Meta will fetch. */
export interface CardImage {
  url: string;
  path: string;
}

/** What an upload adds: the optimised dimensions, for the thumbnail's label. */
export interface UploadedCardImage extends CardImage {
  width: number | null;
  height: number | null;
}

/** The pictures already stored for this agent, newest first. */
export function fetchCardImages(
  agentId: string,
): Promise<{ images: (CardImage & { updatedAt: string | null })[] }> {
  return request(`/v1/agents/${agentId}/bot/media`, { method: "GET" });
}

/**
 * Stores one picture and answers its permanent address.
 *
 * The API validates the bytes and re-encodes them (rotated, resized to 1080 px,
 * JPEG), so what comes back is already the file every customer will download.
 * Content type is left to the browser: setting it by hand drops the multipart
 * boundary `fetch` generated.
 */
export function uploadCardImage(
  agentId: string,
  file: File,
): Promise<UploadedCardImage> {
  const form = new FormData();

  form.append("file", file);

  return upload<UploadedCardImage>(`/v1/agents/${agentId}/bot/media`, form);
}

/**
 * Deletes one uploaded picture from Supabase, for good.
 *
 * Owner-only. The server refuses while a saved card still points at the picture
 * (409 `BOT_IMAGE_IN_USE`) and for a path that is not this agent's
 * (400 `BOT_IMAGE_UNKNOWN`); both carry a sentence meant for the screen.
 */
export function removeCardImage(
  agentId: string,
  path: string,
): Promise<{ removed: boolean }> {
  return request(
    `/v1/agents/${agentId}/bot/media?path=${encodeURIComponent(path)}`,
    { method: "DELETE" },
  );
}
