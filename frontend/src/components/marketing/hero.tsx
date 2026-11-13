"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { MotionConfig, motion, type Variants } from "motion/react";

import { WhatsAppChat } from "@/components/marketing/whatsapp-chat";
import { AnimatedGroup } from "@/components/ui/animated-group";
import { Iphone15Pro } from "@/components/ui/iphone-15-pro";
import { OriginButton } from "@/components/ui/origin-button";
import { site } from "@/config/site";

const textVariants: Variants = {
  hidden: { opacity: 0, y: 18, filter: "blur(8px)" },
  visible: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { type: "spring", bounce: 0.2, duration: 0.9 },
  },
};

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { delayChildren: 0.08, staggerChildren: 0.08 },
  },
};

/**
 * Hero built as a single orange sheet, matching the footer: deepest behind the
 * copy so white text clears AA, brightest under the phone so the device reads
 * as the light source.
 */
export function Hero() {
  const router = useRouter();

  return (
    <MotionConfig reducedMotion="user">
      <section className="relative isolate overflow-hidden text-white">
        <div aria-hidden="true" className="absolute inset-0 -z-20 bg-[#b0420f]" />
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-20 bg-[linear-gradient(180deg,#9c3a11_0%,#a83e10_45%,#bf490d_80%,#d0510c_100%)]"
        />
        <div aria-hidden="true" className="sheet-grain -z-10" />

        <div className="mx-auto w-full max-w-7xl px-5 lg:px-8">
          <AnimatedGroup
            className="mx-auto max-w-6xl gap-6 pt-14 text-center sm:pt-20"
            variants={{ container: containerVariants, item: textVariants }}
          >
            <span className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/85 backdrop-blur-sm">
              <span className="size-1.5 rounded-full bg-[#d9f99d]" aria-hidden="true" />
              Managed WhatsApp automation
            </span>

            {/* Sized to hold the whole headline on one line from tablet up: the
                copy column is wide enough that the clamp never has to wrap. */}
            <h1 className="text-[clamp(2rem,5.2vw,4.25rem)] font-semibold leading-[1.05] tracking-[-0.04em] text-balance">
              Your WhatsApp channel,{" "}
              <span className="text-[#d9f99d]">run properly</span>.
            </h1>

            <p className="max-w-xl text-sm leading-relaxed text-white/90 sm:text-[15px]">
              {site.description} One subscription, one workspace, and a database
              of your own from the moment your payment clears.
            </p>

            <div className="mt-1 flex w-full flex-col items-center justify-center gap-3 sm:w-auto sm:flex-row">
              <OriginButton
                className="w-full sm:w-auto"
                onClick={() => router.push(site.links.pricing)}
              >
                Start with a plan
                <ArrowRight className="size-4" />
              </OriginButton>
              <Link
                href={site.links.login}
                className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-white/50 px-8 text-[15px] font-medium tracking-[-0.02em] text-white transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#9a3412] sm:w-auto"
              >
                Log in to your workspace
              </Link>
            </div>

            <p className="text-[12px] text-white/75">
              No card required · Live in 24 hours · Cancel anytime
            </p>
          </AnimatedGroup>

          {/* The device is taller than its box: the sheet crops it, and the mask
              dissolves the cut so it reads as sliding out of frame. */}
          <div className="relative mx-auto mt-12 w-[clamp(256px,66vw,384px)] sm:mt-14">
            {/* Light source behind the device, anchored to it so the sheet never
                bottoms out in a bright band wherever the copy happens to end. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -inset-x-24 -top-12 bottom-24 -z-10 bg-[radial-gradient(50%_50%_at_50%_45%,rgba(255,214,170,0.22),transparent_78%)]"
            />
            <motion.div
              initial={{ opacity: 0, y: 28 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="relative h-[clamp(320px,54vh,470px)] overflow-hidden [mask-image:linear-gradient(to_bottom,#000_70%,rgba(0,0,0,0.4)_86%,transparent_95%)]"
            >
              <Iphone15Pro>
                <WhatsAppChat />
              </Iphone15Pro>
            </motion.div>
          </div>
        </div>
      </section>
    </MotionConfig>
  );
}
