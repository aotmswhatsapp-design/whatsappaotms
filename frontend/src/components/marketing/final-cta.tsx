import { ArrowRight } from "@phosphor-icons/react/dist/ssr";

import { CtaLink } from "@/components/marketing/cta-link";
import { Reveal } from "@/components/marketing/reveal";
import { site } from "@/config/site";

/**
 * Final call to action: the same offer and the same button as the hero.
 *
 * The card is the page's second black band. It is inset rather than run full
 * bleed, because a full width band of near black directly above the black
 * footer would read as one slab instead of as a seal.
 *
 * On near black the accent lifts to the lighter green, so the action keeps its
 * contrast against the card instead of going quiet. The two lines under the
 * heading sit at 75 and 70 percent, which keeps both well over 4.5:1.
 */
export function FinalCta() {
  return (
    <section className="px-4 py-16 sm:px-6 lg:py-24">
      <div
        data-theme="ink"
        className="mx-auto w-full max-w-6xl rounded-3xl bg-background px-6 py-14 text-foreground sm:px-10 lg:py-20"
      >
        <Reveal className="mx-auto max-w-[680px] text-center">
          <h2 className="heading-2 text-foreground">
            Ship your first WhatsApp campaign in a day.
          </h2>
          <p className="title-2 mt-6 text-foreground/75">
            Choose a plan and we take it from verification to the first send.
          </p>
          <div className="mt-8 flex justify-center">
            <CtaLink href={site.links.pricing} variant="brand">
              Start with a plan
              <ArrowRight className="size-4" weight="bold" aria-hidden="true" />
            </CtaLink>
          </div>
          <p className="caption-2 mt-4 text-foreground/70">
            Billed monthly. No annual lock in unless you choose it.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
