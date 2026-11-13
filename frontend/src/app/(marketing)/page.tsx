import { Hero } from "@/components/marketing/hero";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { Integrations } from "@/components/marketing/integrations";
import { Pricing } from "@/components/marketing/pricing";
import { plans } from "@/config/plans";

export default function HomePage() {
  return (
    <>
      <Hero />
      <Integrations />
      <HowItWorks />
      <Pricing plans={plans} />
    </>
  );
}
