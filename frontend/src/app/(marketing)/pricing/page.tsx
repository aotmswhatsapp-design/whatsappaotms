import type { Metadata } from "next";

import { Pricing } from "@/components/marketing/pricing";
import { plans } from "@/config/plans";

export const metadata: Metadata = { title: "Pricing" };

export default function PricingPage() {
  return <Pricing plans={plans} />;
}
