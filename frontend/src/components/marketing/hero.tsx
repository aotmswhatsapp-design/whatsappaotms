import { ArrowRight, CheckCircle } from "@phosphor-icons/react/dist/ssr";

import { CtaLink } from "@/components/marketing/cta-link";
import { HeroArt } from "@/components/marketing/hero-art";
import { site } from "@/config/site";

/**
 * Hero: two columns from `lg`, copy first.
 *
 * The field is flat white. The colour is carried by the artwork on the right —
 * a mint disc and a light blue slab — rather than by a wash behind the copy, so
 * the headline is read on paper and the eye has one place to land afterwards.
 *
 * The copy column is indented 56px from `lg` and the spark mark hangs in that
 * gutter. The reference hero is inset the same way: a heading flush to the grid
 * edge with a mark beside it reads as one block, while a mark floating over the
 * text reads as a sticker.
 *
 * The section still slides under the transparent bar (`-mt-20 pt-20`), so the
 * white field runs to the top of the window instead of starting at a seam.
 */
export function Hero() {
  return (
    <section className="relative -mt-20 overflow-hidden border-b border-border bg-background pt-20">
      <div className="mx-auto w-full max-w-6xl px-4 pt-10 pb-16 sm:px-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] lg:items-end lg:gap-12 lg:pt-16 lg:pb-24 xl:max-w-7xl">
        <div className="relative lg:pl-14">
          {/* The reference's motion mark, hanging in the copy's gutter. It is
              hidden where the copy is full width, because below `lg` there is
              no gutter to hang it in. */}
          <SparkMark className="absolute top-[3.1rem] left-0 hidden w-11 text-blue/55 lg:block" />

          <p className="title-1 text-foreground">Managed WhatsApp automation</p>

          {/* Near black on white is 19:1, so the headline takes the plain
              foreground and the green stays on the action below it. The size
              is set on the headline alone: `.heading-1` tops out at 60px, and
              the hero is the one place that steps past the scale. */}
          <h1 className="heading-1 mt-3 text-[2.5rem] leading-[1.05] text-foreground sm:text-[3rem] sm:leading-none lg:text-[4rem] lg:leading-[1] xl:text-[4.5rem] xl:leading-[0.98]">
            Your first WhatsApp campaign in a day
          </h1>

          <p className="title-1 mt-6 max-w-[600px] leading-8 text-muted-foreground">
            Campaigns, a shared inbox, chatbots and analytics on one workspace.
            Starter, Growth or Business, with the modules inside. We set up the
            Meta app and connect the number with you, on site.
          </p>

          <div className="mt-8 flex flex-col items-stretch gap-4 sm:flex-row sm:items-center">
            <CtaLink href={site.links.pricing} variant="pop">
              See the pricing
              <ArrowRight className="size-4" weight="bold" aria-hidden="true" />
            </CtaLink>
            <CtaLink href="/how-it-works" variant="outline">
              See how it works
            </CtaLink>
          </div>

          <p className="body-5 mt-6 text-muted-foreground">
            <CheckCircle
              className="mr-2 inline size-4 -translate-y-px text-brand align-middle"
              weight="fill"
              aria-hidden="true"
            />
            Live the same day. The Meta app, number and payment method are set
            up with you.
          </p>
        </div>

        {/* The negative bottom margin cancels the container's padding, so the
            photograph is cropped by the section's border instead of ending on a
            straight line inside the white field. */}
        <div className="mt-14 -mb-16 sm:mt-16 lg:mt-0 lg:-mb-24">
          <HeroArt />
        </div>
      </div>
    </section>
  );
}

/**
 * Three strokes opening away from the headline, which is what the reference's
 * mark is: motion escaping the text rather than an icon sitting next to it.
 */
function SparkMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 26 40"
      aria-hidden="true"
      className={`h-auto ${className ?? ""}`}
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth={4}
        strokeLinecap="round"
      >
        <path d="M16 5L3 14" />
        <path d="M23 20H1" />
        <path d="M16 35L3 26" />
      </g>
    </svg>
  );
}
