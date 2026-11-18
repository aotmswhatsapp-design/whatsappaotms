import { request } from "./http";

/** The four signals the sidebar dot can show. */
export type ConnectionState = "none" | "pending" | "live" | "error";

export interface ConnectionStatus {
  state: ConnectionState;
  /** Only set for `error`: the sentence the tooltip shows. */
  reason: string | null;
}

/**
 * Fired after anything that could change the connection: a completed wizard, a
 * disconnect, a re-check. The sidebar listens so the dot does not need a reload.
 */
export const WHATSAPP_STATUS_EVENT = "whatsapp:status";

export function notifyWhatsAppStatus(): void {
  window.dispatchEvent(new Event(WHATSAPP_STATUS_EVENT));
}

export function fetchWhatsAppStatus(): Promise<ConnectionStatus> {
  return request<ConnectionStatus>("/v1/whatsapp/status", { method: "GET" });
}
