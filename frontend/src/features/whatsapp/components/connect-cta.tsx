"use client";

import Link from "next/link";
import { CircleCheck, PlugZap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useWhatsAppStatus } from "@/hooks/use-whatsapp-status";

/**
 * The Overview masthead action.
 *
 * The dashboard is the first screen after sign-in, so this button doubles as
 * the channel's headline status. `live` means Meta verified the webhook and is
 * delivering events, so the action is already done: the control turns into a
 * quiet "Connected" chip that still links to the settings page. Every other
 * state still needs the customer, so it keeps the call to connect.
 *
 * It reads the same `/v1/whatsapp/status` answer the sidebar dot uses, so the
 * two can never disagree.
 */
export function ConnectCta() {
  const status = useWhatsAppStatus();

  if (status.state === "live") {
    return (
      <Button asChild variant="outline">
        <Link
          aria-label="WhatsApp is connected — open connection settings"
          href="/workspace/whatsapp"
        >
          <CircleCheck aria-hidden="true" className="text-lime" />
          Connected
        </Link>
      </Button>
    );
  }

  return (
    <Button asChild variant="brand">
      <Link href="/workspace/whatsapp">
        <PlugZap />
        Connect WhatsApp
      </Link>
    </Button>
  );
}
