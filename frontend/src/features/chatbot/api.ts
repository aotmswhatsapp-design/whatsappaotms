import { request } from "@/lib/api/http";
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
