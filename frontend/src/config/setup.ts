/**
 * The one-time setup fee.
 *
 * Charged once, when the workspace is set up, and never again on renewal — so
 * it is deliberately kept out of `pricing.ts`, where every number recurs.
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
      title: "Meta app and developer account",
      detail:
        "Created with you on site: the business portfolio, the app, the system user token and the webhook.",
    },
    {
      title: "WhatsApp number onboarding",
      detail:
        "The number is taken off the WhatsApp app, registered on the Cloud API and test-sent before you go live.",
    },
    {
      title: "Payment method and verification",
      detail:
        "The card goes on your own WhatsApp account, and we file business verification and follow it until Meta approves.",
    },
    {
      title: "First message templates",
      detail:
        "We write and submit your opening templates, then rework anything Meta rejects.",
    },
    {
      title: "Workspace, modules and team",
      detail:
        "Team invites, roles and the modules in your plan are configured before handover.",
    },
  ],
} as const;
