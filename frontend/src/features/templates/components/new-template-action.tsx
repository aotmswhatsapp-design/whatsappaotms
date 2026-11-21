"use client";

import Link from "next/link";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useWhatsAppStatus } from "@/hooks/use-whatsapp-status";

/**
 * The templates masthead action.
 *
 * It carries the marketing hero's pressable treatment into the app: a brand
 * plate over a slab of its own colour, so hovering steps the button into the
 * shadow instead of lifting it off the page.
 *
 * The button appears only once a number is registered. The body of the page
 * already asks a workspace without one to connect, and a second route into a
 * form Meta cannot accept would be noise rather than an action.
 */
export function NewTemplateAction() {
  const status = useWhatsAppStatus();

  if (status.number === null) return null;

  return (
    <Button asChild size="lg" variant="pop">
      <Link href="/workspace/templates/new">
        <Plus />
        New template
      </Link>
    </Button>
  );
}
