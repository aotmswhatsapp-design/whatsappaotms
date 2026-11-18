"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import {
  fetchWhatsAppStatus,
  WHATSAPP_STATUS_EVENT,
  type ConnectionStatus,
} from "@/lib/api/whatsapp-status";

const UNKNOWN: ConnectionStatus = { state: "none", reason: null };

/**
 * The sidebar's colour, kept current without polling.
 *
 * One read on mount, another on every route change (the API answers from a
 * five-minute cache, so this is cheap), and one whenever the wizard says the
 * connection moved. A failed read keeps the last known answer: a dot is
 * decoration, and flapping to "not connected" on a network blip would be worse
 * than being briefly stale.
 */
export function useWhatsAppStatus(): ConnectionStatus {
  const pathname = usePathname();
  const [status, setStatus] = React.useState<ConnectionStatus>(UNKNOWN);

  React.useEffect(() => {
    let active = true;

    const load = () => {
      fetchWhatsAppStatus()
        .then((next) => {
          if (active) setStatus(next);
        })
        .catch(() => {
          /* keep the previous answer */
        });
    };

    load();
    window.addEventListener(WHATSAPP_STATUS_EVENT, load);

    return () => {
      active = false;
      window.removeEventListener(WHATSAPP_STATUS_EVENT, load);
    };
  }, [pathname]);

  return status;
}
