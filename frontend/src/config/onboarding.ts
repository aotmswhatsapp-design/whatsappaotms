import { Megaphone, PlugZap, Upload } from "lucide-react";

import type { LucideIcon } from "lucide-react";

export interface OnboardingStep {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
}

/**
 * The three steps between a fresh account and a working WhatsApp channel.
 * Shared by the overview checklist and the notification feed so both always
 * describe the same path.
 */
export const onboardingSteps: OnboardingStep[] = [
  {
    title: "Connect WhatsApp",
    description: "Authorise your Business account and register a number.",
    href: "/workspace/whatsapp",
    icon: PlugZap,
  },
  {
    title: "Import contacts",
    description: "Upload a CSV or add your first contact by hand.",
    href: "/workspace/contacts",
    icon: Upload,
  },
  {
    title: "Launch a campaign",
    description: "Pick an approved template and send it to a segment.",
    href: "/workspace/campaigns",
    icon: Megaphone,
  },
];
