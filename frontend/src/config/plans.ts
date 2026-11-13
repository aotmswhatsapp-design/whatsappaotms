import type { PricingPlan } from "@/components/marketing/pricing";

/**
 * `yearlyPrice` is the monthly-equivalent when billed annually (20% off),
 * not the annual total — the pricing component renders it as `₹x / month`.
 *
 * Plan buttons point at /contact until a Razorpay checkout flow exists.
 */
export const plans: PricingPlan[] = [
  {
    name: "Starter",
    price: "1499",
    yearlyPrice: "1199",
    period: "month",
    features: [
      "1 WhatsApp number",
      "1,000 conversations a month",
      "Shared inbox for 2 agents",
      "5 chatbot flows",
      "Email support",
    ],
    description: "For a first WhatsApp channel that has to look professional.",
    buttonText: "Choose Starter",
    href: "/contact",
    isPopular: false,
  },
  {
    name: "Growth",
    price: "3999",
    yearlyPrice: "3199",
    period: "month",
    features: [
      "1 WhatsApp number",
      "10,000 conversations a month",
      "Shared inbox for 10 agents",
      "Unlimited chatbot flows",
      "Campaigns, segments and analytics",
      "Priority support",
    ],
    description: "For teams running campaigns and a live inbox every day.",
    buttonText: "Choose Growth",
    href: "/contact",
    isPopular: true,
  },
  {
    name: "Business",
    price: "8999",
    yearlyPrice: "7199",
    period: "month",
    features: [
      "Multiple WhatsApp numbers",
      "50,000 conversations a month",
      "Shared inbox for 50 agents",
      "REST API and webhooks",
      "Single sign-on and audit logs",
      "Dedicated onboarding",
    ],
    description: "For operations that need scale, integrations and controls.",
    buttonText: "Choose Business",
    href: "/contact",
    isPopular: false,
  },
];
