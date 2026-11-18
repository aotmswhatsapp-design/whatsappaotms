import type { Metadata } from "next";
import dynamic from "next/dynamic";

import { Benefits } from "@/components/marketing/benefits";
import { FinalCta } from "@/components/marketing/final-cta";
import { Hero } from "@/components/marketing/hero";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { LogoStrip } from "@/components/marketing/logo-strip";
import { ProblemSolution } from "@/components/marketing/problem-solution";
import { ProductSurface } from "@/components/marketing/product-surface";
import { SetupCost } from "@/components/marketing/setup-cost";
import { faqs } from "@/config/faq";
import { plans } from "@/config/plans";
import { site } from "@/config/site";

/**
 * The three islands below are `next/dynamic` client chunks, so their factories
 * only exist once the browser asks for them. Cache Components' instant-navigation
 * validation re-renders this route in a separate prefetch environment, where that
 * lookup fails with "module factory is not available" and the whole route is
 * reported as unvalidatable. Opting the page out keeps the code split; the route
 * is still fully prerendered.
 */
export const instant = false;

/**
 * Lazy islands. The three interactive sections sit below the fold, so their
 * JavaScript is split out of the first load and fetched when the reader scrolls
 * near them. They still render on the server, so the markup is in the HTML and
 * there is nothing to shift when the chunk lands.
 */
const Pricing = dynamic(() =>
  import("@/components/marketing/pricing").then((module) => module.Pricing),
);
const Faq = dynamic(() =>
  import("@/components/marketing/faq").then((module) => module.Faq),
);
const TaglineReveal = dynamic(() =>
  import("@/components/marketing/tagline-reveal").then(
    (module) => module.TaglineReveal,
  ),
);

const brandName = site.name.trim() || "AOTMS";
const description =
  "Managed WhatsApp automation for growing businesses. Choose a plan and we build the workspace, connect your number and get you live within 24 hours.";

export const metadata: Metadata = {
  title: "WhatsApp automation, live in a day",
  description,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: brandName,
    title: `WhatsApp automation, live in a day | ${brandName}`,
    description,
    images: [
      {
        url: site.logo.src,
        width: site.logo.width,
        height: site.logo.height,
        alt: site.logo.alt,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `WhatsApp automation, live in a day | ${brandName}`,
    description,
    images: [site.logo.src],
  },
};

/** The same questions the FAQ section renders, in the form search engines read. */
const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map((faq) => ({
    "@type": "Question",
    name: faq.question,
    acceptedAnswer: { "@type": "Answer", text: faq.answer },
  })),
};

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      <Hero />
      <LogoStrip />
      <TaglineReveal />
      <ProblemSolution />
      <Benefits />
      <HowItWorks />
      <ProductSurface />
      <Pricing plans={plans} />
      <SetupCost />
      <Faq />
      <FinalCta />
    </>
  );
}
