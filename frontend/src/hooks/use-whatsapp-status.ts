"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import {
  fetchWhatsAppStatus,
  readWhatsAppStatus,
  subscribeWhatsAppStatus,
  WHATSAPP_STATUS_EVENT,
  type ConnectionStatus,
} from "@/lib/api/whatsapp-status";

const UNKNOWN: ConnectionStatus = { state: "none", reason: null, number: null };

/**
 * The sidebar's colour, kept current without polling.
 *
 * One read on mount, another on every route change (the API answers from a
 * five-minute cache, so this is cheap), and one whenever the wizard says the
 * connection moved. A failed read keeps the last known answer: a dot is
 * decoration, and flapping to "not connected" on a network blip would be worse
 * than being briefly stale.
 *
 * The answer lives in a module-level store rather than this component's state,
 * so the sidebar and the dashboard button read one value. `useSyncExternalStore`
 * renders the store's *server* snapshot (`null`) on the server and while
 * hydrating, then switches to the tab's real answer — a state initialiser would
 * have hydrated the cached answer against server markup that cannot know it.
 */
export function useWhatsAppStatus(): ConnectionStatus {
  const pathname = usePathname();
  const stored = React.useSyncExternalStore(
    subscribeWhatsAppStatus,
    readWhatsAppStatus,
    () => null,
  );

  React.useEffect(() => {
    const load = () => {
      // Failures leave the previous answer in place; the store only moves on a
      // real reply.
      fetchWhatsAppStatus().catch(() => {});
    };

    load();
    window.addEventListener(WHATSAPP_STATUS_EVENT, load);

    return () => {
      window.removeEventListener(WHATSAPP_STATUS_EVENT, load);
    };
  }, [pathname]);

  return stored ?? UNKNOWN;
}
