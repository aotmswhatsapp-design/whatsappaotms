"use client";

import Link from "next/link";
import { PlugZap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAccess } from "@/components/workspace/access-provider";

/**
 * "Connect WhatsApp", offered to the workspace owner alone.
 *
 * The number belongs to the workspace, not to whoever is reading the screen:
 * an invited Admin, Manager or Agent works the owner's connection and must
 * never be asked to add their own. The component answers with nothing for
 * them, so a shared empty state can carry it unconditionally.
 *
 * Role arrives with the page, because the shell holds its children back until
 * the access answer is in, so no prompt can flash for a member and then leave.
 */
export function ConnectWhatsAppAction() {
  const { role } = useAccess();

  if (role !== "OWNER") return null;

  return (
    <Button asChild variant="brand">
      <Link href="/workspace/whatsapp">
        <PlugZap aria-hidden="true" />
        Connect WhatsApp
      </Link>
    </Button>
  );
}
