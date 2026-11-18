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

/**
 * The last answer this tab received, plus who to tell when a newer one lands.
 *
 * Two consumers read it (the sidebar dot and the dashboard button); sharing one
 * cache keeps them from disagreeing and lets both start from the truth on a
 * client-side navigation. It is deliberately empty on the server — there is no
 * session there — which is why consumers reach it through
 * `useSyncExternalStore` rather than a state initialiser.
 */
let lastKnown: ConnectionStatus | null = null;
const listeners = new Set<() => void>();
let inFlight: Promise<ConnectionStatus> | null = null;

export function fetchWhatsAppStatus(): Promise<ConnectionStatus> {
  // Two consumers mounting on the same navigation must cost one request.
  if (inFlight) return inFlight;

  const pending = request<ConnectionStatus>("/v1/whatsapp/status", {
    method: "GET",
  })
    .then((status) => {
      lastKnown = status;
      for (const listener of listeners) listener();
      return status;
    })
    .finally(() => {
      inFlight = null;
    });

  inFlight = pending;
  return pending;
}

export function subscribeWhatsAppStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The client snapshot: `null` until this tab has heard from the API. */
export function readWhatsAppStatus(): ConnectionStatus | null {
  return lastKnown;
}
