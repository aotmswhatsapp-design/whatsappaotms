import type { PricingPlan } from "@/components/marketing/pricing";

/**
 * Three plans, and the modules are unlocked *inside* them rather than priced
 * separately. Every plan runs the same workspace (inbox, contacts, team,
 * WhatsApp connection); what changes is which modules a client can open.
 *
 * Every plan covers exactly one WhatsApp number, because a workspace holds a
 * single connection (`WhatsAppAccount.workspaceId` is unique). A client with
 * three numbers therefore runs three workspaces, each on its own plan — the
 * cards say so rather than leaving it to be discovered at onboarding.
 *
 * Meta's own message charges are deliberately absent. Meta bills those to the
 * client's WhatsApp Business account on the client's own card, so no number
 * here is a resale of Meta's rate.
 *
 * Price fields are display strings that already carry their thousands
 * separator:
 *   - `price`       the monthly price
 *   - `yearlyPrice` the monthly equivalent when billed annually (10% off)
 *   - `yearlyTotal` the amount charged once a year, always `yearlyPrice` × 12
 *   - `yearlySaving` what the year costs less than twelve monthly payments
 * The card prints the monthly figure first and the yearly amount on the line
 * below it, so all four have to agree. Every price on the site reads from this
 * file, so changing a number here changes the landing page, the pricing page
 * and the setup section together.
 */
export const annualDiscountPercent = 10;

/** The module catalogue, in the order the cards list it. */
const ALL_MODULES = [
  "Campaigns",
  "Chatbot flows",
  "Automation rules",
  "AI agent",
  "Analytics",
  "REST API and webhooks",
] as const;

type ModuleName = (typeof ALL_MODULES)[number];

/**
 * Every plan lists the full catalogue so the three cards line up and a client
 * can see what the next tier adds; `included` decides the check or the dash.
 */
const moduleAccess = (...included: ModuleName[]) =>
  ALL_MODULES.map((name) => ({ name, included: included.includes(name) }));

export const plans: PricingPlan[] = [
  {
    name: "Starter",
    price: "1499",
    yearlyPrice: "1349",
    yearlyTotal: "16188",
    yearlySaving: "1800",
    period: "month",
    description: "One WhatsApp channel, run properly from day one.",
    features: [
      "WhatsApp for 1 number",
      "Login to One CRM",
      "3500 Conversations per month",
      "No Templates included",
      "-",
      "-",
      "-",
      "-",
      "Email support",
    ],
    modules: moduleAccess(),
    buttonText: "Choose Starter",
    href: "/contact",
    isPopular: false,
  },
  {
    name: "Growth",
    price: "3999",
    yearlyPrice: "3599",
    yearlyTotal: "43188",
    yearlySaving: "4800",
    period: "month",
    description: "For teams sending campaigns and answering a live inbox daily.",
    features: [
      "Owner + 7 agents included",
      "1500 Conversations per month",
      "2 Templates + 2 Blasting campaigns",
      "Visual flow builder for WhatsApp journeys (lead capture, follow-ups, COD flows)",
      "Instagram Automation Also included",
      "2 accounts Logins included",
      "2 Reports & Analytics",
      "-",
      "-",
      "-",
      "24/7 Support",
    ],
    modules: moduleAccess(
      "Campaigns",
      "Chatbot flows",
      "Automation rules",
      "Analytics",
    ),
    buttonText: "Choose Growth",
    href: "/contact",
    isPopular: true,
  },
  {
    name: "Business",
    price: "8999",
    yearlyPrice: "8099",
    yearlyTotal: "97188",
    yearlySaving: "10800",
    period: "month",
    description: "Every module, plus the controls an operations team asks for.",
    features: [
      "Owner + 15 agents included",
      "3500 Conversations per month",
      "5 Templates + 2 Blasting campaigns",
      "AI-assisted flow builder with intent-based routing",
      "Al content writer, reply suggestions & flow blueprints",
      "Advanced CRM workflows + AI lead scoring",
      "Instagram automation included",
      "Multiple accounts logins included",
      "Multiple reports & analytics",
      "24/7 Support with Team Support included",
    ],
    modules: moduleAccess(
      "Campaigns",
      "Chatbot flows",
      "Automation rules",
      "AI agent",
      "Analytics",
      "REST API and webhooks",
    ),
    buttonText: "Choose Business",
    href: "/contact",
    isPopular: false,
  },
];
