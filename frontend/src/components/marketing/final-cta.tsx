import { ArrowRight } from "@phosphor-icons/react/dist/ssr";

import { CtaLink } from "@/components/marketing/cta-link";
import { Reveal } from "@/components/marketing/reveal";
import { site } from "@/config/site";

/**
 * Final call to action: the same offer and the same button as the hero.
 *
 * The accent is spent here and nowhere else at this size. It is inset as a slab
 * rather than run full bleed, because a full width band of accent above a dark
 * footer reads as a warning stripe; a contained panel reads as a seal.
 *
 * Lime is lighter than the gold it replaced, so the copy on it cannot sit as
 * low as 60%: teal at 60% over this fill lands at roughly 3.6:1. 75 and 70 keep
 * both lines over 4.5:1, and size carries the hierarchy instead of opacity.
 */
export function FinalCta() {
  return (
    <section className="px-4 py-16 sm:px-6 lg:py-24">
      <div className="mx-auto w-full max-w-6xl rounded-3xl bg-primary px-6 py-14 text-primary-foreground sm:px-10 lg:py-20">
        <Reveal className="mx-auto max-w-[680px] text-center">
          <h2 className="heading-2 text-primary-foreground">
            Ship your first WhatsApp campaign in a day.
          </h2>
          <p className="title-2 mt-6 text-primary-foreground/75">
            Choose a plan and we take it from verification to the first send.
          </p>
          <div className="mt-8 flex justify-center">
            <CtaLink href={site.links.pricing} variant="inverse">
              Start with a plan
              <ArrowRight className="size-4" weight="bold" aria-hidden="true" />
            </CtaLink>
          </div>
          <p className="caption-2 mt-4 text-primary-foreground/70">
            Billed monthly. No annual lock in unless you choose it.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
