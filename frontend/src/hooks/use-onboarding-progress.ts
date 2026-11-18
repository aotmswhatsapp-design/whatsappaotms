"use client";

import { onboardingSteps, type OnboardingStep } from "@/config/onboarding";
import { useWhatsAppStatus } from "@/hooks/use-whatsapp-status";

export interface OnboardingStepState extends OnboardingStep {
  done: boolean;
}

export interface OnboardingProgress {
  steps: OnboardingStepState[];
  done: number;
  total: number;
  remaining: number;
}

/**
 * The setup checklist, with the one step the API can already answer for.
 *
 * "Connect WhatsApp" is behind the customer as soon as a number is stored and
 * Meta has accepted it — `live` once events flow, `pending` while the webhook
 * is still unconfirmed. The other two steps have no signal yet, so they stay
 * open rather than guessing; the checklist is honest, not decorative.
 *
 * Reads the same `/v1/whatsapp/status` answer as the sidebar dot, the masthead
 * button and the Overview's connection card, so all four always agree.
 */
export function useOnboardingProgress(): OnboardingProgress {
  const status = useWhatsAppStatus();
  const connected = status.state === "live" || status.state === "pending";

  const steps = onboardingSteps.map((step, index) => ({
    ...step,
    done: index === 0 && connected,
  }));

  const done = steps.filter((step) => step.done).length;

  return { steps, done, total: steps.length, remaining: steps.length - done };
}
