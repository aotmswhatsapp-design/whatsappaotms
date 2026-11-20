import { ArrowRight, CheckCircle } from "@phosphor-icons/react/dist/ssr";

import { CtaLink } from "@/components/marketing/cta-link";
import { HeroClouds } from "@/components/marketing/hero-clouds";
import { WhatsAppChat } from "@/components/marketing/whatsapp-chat";
import { Iphone15Pro } from "@/components/ui/iphone-15-pro";
import { site } from "@/config/site";

/**
 * Hero: one offer, one action, and the product itself rather than a picture of
 * it. Centred, because the phone below needs the full width to read as a
 * device sitting on the page; the copy column stops at 680px either way.
 *
 * The section is lifted under the transparent bar and carries the page's only
 * accent wash. Lime sits at 8% rather than higher because lime over teal
 * blends toward sea-green past roughly 10%, which reads as a stain instead of
 * as light; at this stop the source bleeds from the top of the window and
 * settles back into the field by the middle of the hero.
 *
 * The cloud layer behind it is the only WebGL on the site. It is painted under
 * the copy and holds low density in the centre band, so the headline is always
 * read on flat field instead of on lit cloud.
 */
export function Hero() {
  return (
    <section className="relative -mt-18 overflow-hidden border-b border-border bg-linear-to-b from-brand/8 via-background via-45% to-background pt-18">
      <HeroClouds />

      {/* Three signal motes: the only accent in the hero above the button. They
          sit clear of the copy column, and are hidden where that column is the
          full width of the screen. */}
      <span
        aria-hidden="true"
        className="hero-mote top-[24%] left-[8%] hidden size-[5px] [animation-delay:-6s] [animation-duration:46s] sm:block"
      />
      <span
        aria-hidden="true"
        className="hero-mote top-[30%] right-[11%] hidden size-[4px] [animation-delay:-19s] [animation-duration:58s] sm:block"
      />
      <span
        aria-hidden="true"
        className="hero-mote top-[47%] left-[14%] hidden size-[3px] [animation-delay:-31s] [animation-duration:52s] sm:block"
      />

      {/* `relative` is load-bearing: the canvas above is positioned, so without
          it the copy would paint underneath the clouds. */}
      <div className="relative mx-auto w-full max-w-6xl px-4 pt-16 sm:px-6 lg:pt-20 xl:max-w-7xl">
        <div className="mx-auto flex flex-col items-center text-center">
          <p className="caption-3 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-muted-foreground">
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full bg-brand"
            />
            Managed WhatsApp automation
          </p>

          {/* Pearl on teal is 12.0:1, so the headline takes the plain foreground
              and the lime stays on the action below it. */}
          <h1 className="heading-1 mt-6 text-foreground xl:whitespace-nowrap">
            Your first WhatsApp campaign in a day
          </h1>

          <p className="title-2 mt-6 max-w-[680px] text-muted-foreground">
            Campaigns, a shared inbox, chatbots and analytics on one workspace.
            Starter, Growth or Business, with the modules inside. We set up the
            Meta app and connect the number with you, on site.
          </p>

          <div className="mt-8 flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-center">
            <CtaLink href={site.links.pricing}>
              See the pricing
              <ArrowRight className="size-4" weight="bold" aria-hidden="true" />
            </CtaLink>
            <CtaLink href="/how-it-works" variant="outline">
              See how it works
            </CtaLink>
          </div>

          <p className="body-5 mt-6 text-center text-muted-foreground">
            <CheckCircle
              className="mr-2 inline size-4 -translate-y-px text-brand align-middle"
              weight="fill"
              aria-hidden="true"
            />
            Live the same day. The Meta app, number and payment method are set
            up with you.
          </p>
        </div>

        {/* The device is taller than its box: the box crops it and the mask
            dissolves the cut, so the phone reads as sliding out of frame
            instead of stopping on a hard edge. */}
        <div className="relative mx-auto mt-12 w-[clamp(256px,66vw,384px)] sm:mt-16">
          <div className="relative h-[clamp(320px,54vh,470px)] overflow-hidden [mask-image:linear-gradient(to_bottom,#000_70%,rgba(0,0,0,0.4)_86%,transparent_95%)]">
            <Iphone15Pro>
              <WhatsAppChat />
            </Iphone15Pro>
          </div>
        </div>
      </div>
    </section>
  );
}
