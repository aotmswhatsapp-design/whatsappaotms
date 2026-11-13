import type { Metadata } from "next";

import { HowItWorks } from "@/components/marketing/how-it-works";

export const metadata: Metadata = { title: "How it works" };

export default function HowItWorksPage() {
  return <HowItWorks />;
}
