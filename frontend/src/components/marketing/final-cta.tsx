import { ArrowRight } from "@phosphor-icons/react/dist/ssr";

import { CtaLink } from "@/components/marketing/cta-link";
import { Reveal } from "@/components/marketing/reveal";
import { site } from "@/config/site";

/** Final call to action: the same offer and the same button as the hero. */
export function FinalCta() {
  return (
    <section className="bg-foreground">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
        <Reveal className="mx-auto max-w-[680px] text-center">
          <h2 className="heading-2 text-white">
            Ship your first WhatsApp campaign in a day.
          </h2>
          <p className="title-2 mt-6 text-white/70">
            Choose a plan and we take it from verification to the first send.
          </p>
          <div className="mt-8 flex justify-center">
            <CtaLink href={site.links.pricing}>
              Start with a plan
              <ArrowRight className="size-4" weight="bold" aria-hidden="true" />
            </CtaLink>
          </div>
          <p className="caption-2 mt-4 text-white/60">
            Billed monthly. No annual lock in unless you choose it.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
