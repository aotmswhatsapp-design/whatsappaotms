import { ArrowRight, CheckCircle } from "@phosphor-icons/react/dist/ssr";

import { CtaLink } from "@/components/marketing/cta-link";
import { WhatsAppChat } from "@/components/marketing/whatsapp-chat";
import { Iphone15Pro } from "@/components/ui/iphone-15-pro";
import { site } from "@/config/site";

/**
 * Hero: one offer, one action, and the product itself rather than a picture of
 * it. Centred, because the phone below needs the full width to read as a
 * device sitting on the page; the copy column stops at 680px either way.
 *
 * The heading carries the only gradient on the page and it is on the text. The
 * section itself is lifted under the transparent bar so the blue shade runs
 * from the very top of the window down to roughly the middle of the hero.
 */
export function Hero() {
  return (
    <section className="relative -mt-18 overflow-hidden border-b border-border bg-linear-to-b from-blue-soft via-background via-45% to-background pt-18">
      <div className="mx-auto w-full max-w-6xl px-4 pt-16 sm:px-6 lg:pt-20 xl:max-w-7xl">
        <div className="mx-auto flex flex-col items-center text-center">
          <p className="caption-3 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-muted-foreground">
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full bg-blue"
            />
            Managed WhatsApp automation
          </p>

          <h1 className="heading-1 mt-6 bg-linear-to-r from-black to-[#666666] bg-clip-text text-transparent xl:whitespace-nowrap">
            Your first WhatsApp campaign in a day
          </h1>

          <p className="title-2 mt-6 max-w-[680px] text-muted-foreground">
            Campaigns, a shared inbox, chatbots and analytics on one workspace.
            You pay, we verify the business, connect the number and build the
            workspace for you.
          </p>

          <div className="mt-8 flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-center">
            <CtaLink href={site.links.pricing}>
              Start with a plan
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
            Live within 24 hours. Setup and Meta verification handled for you.
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
