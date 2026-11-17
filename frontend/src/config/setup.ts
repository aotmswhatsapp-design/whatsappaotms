/**
 * The one-time setup fee.
 *
 * Charged once, when the workspace is built, and never again on renewal — so
 * it is deliberately kept out of `plans.ts`, where every number is recurring.
 * A future Razorpay line item should read `fee` from here rather than repeat
 * the literal.
 *
 * `fee` is a display string: it already carries its thousands separator so the
 * page can print it without a formatter.
 */
export const setup = {
  fee: "14,999",
  gstPercent: 18,
  includes: [
    {
      title: "Meta Business verification",
      detail:
        "We file the business verification on your behalf and follow it through until Meta approves it.",
    },
    {
      title: "WhatsApp number onboarding",
      detail:
        "Your number is registered on the Cloud API and test-sent before you go live, not after.",
    },
    {
      title: "First message templates",
      detail:
        "We write and submit your opening templates, then rework anything Meta rejects.",
    },
    {
      title: "Workspace and plan limits",
      detail:
        "Dedicated database, team invites, chatbot flows and usage limits configured to your plan.",
    },
    {
      title: "Two live onboarding calls",
      detail:
        "Forty-five minutes each, with the team that built the platform — not a reseller.",
    },
  ],
} as const;
