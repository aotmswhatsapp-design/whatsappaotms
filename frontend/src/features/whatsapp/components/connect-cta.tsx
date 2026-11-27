"use client";

import Link from "next/link";
import { CircleCheck, PlugZap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAccess } from "@/components/workspace/access-provider";
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
 * two can never disagree. Only the owner is invited to connect: the number
 * belongs to the workspace, and a member pressing a connect button would land
 * on the read-only card. A member still sees the `live` chip, which is status
 * rather than an instruction.
 */
export function ConnectCta() {
  const status = useWhatsAppStatus();
  const { role } = useAccess();

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

  // The shell holds its children back until the role is known, so this cannot
  // flash a prompt and then withdraw it.
  if (role !== "OWNER") return null;

  return (
    <Button asChild variant="brand">
      <Link href="/workspace/whatsapp">
        <PlugZap />
        Connect WhatsApp
      </Link>
    </Button>
  );
}
