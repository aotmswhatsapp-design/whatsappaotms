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
 * Hero built on an elevated warm-ivory & gold/peach aurora surface so the
 * AOTMS mark, dark ink headline, and WhatsApp device mockup all sit with high
 * contrast and natural warmth.
 */
export function Hero() {
  const router = useRouter();

  return (
    <MotionConfig reducedMotion="user">
      <section className="relative isolate -mt-18 overflow-hidden pt-18 text-[#1e1811]">
        {/* Warm cream-to-white base canvas */}
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-30 bg-[linear-gradient(180deg,#fbf7ef_0%,#fdf9f2_56%,#ffffff_100%)]"
        />

        {/* Elevated multi-tone radial washes: warm gold, soft peach, AOTMS sky blue, and WhatsApp emerald */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-20 bg-[radial-gradient(68%_56%_at_50%_0%,rgba(247,215,151,0.58)_0%,rgba(247,192,151,0.36)_46%,transparent_78%)]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-20 bg-[radial-gradient(42%_42%_at_16%_24%,rgba(37,99,235,0.09)_0%,transparent_72%),radial-gradient(42%_42%_at_84%_28%,rgba(16,185,129,0.10)_0%,transparent_72%)]"
        />
        <div aria-hidden="true" className="sheet-grain -z-10 opacity-18" />

        <div className="mx-auto w-full max-w-7xl px-5 lg:px-8">
          <AnimatedGroup
            className="mx-auto max-w-6xl gap-6 pt-14 text-center sm:pt-20"
            variants={{ container: containerVariants, item: textVariants }}
          >
            <span className="inline-flex items-center gap-2 rounded-full border border-[#e6d8c1] bg-[#fffdf8]/85 px-3.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[#5c5143] shadow-[0_2px_10px_-3px_rgba(30,24,17,0.08)] backdrop-blur-md">
              <span
                className="size-1.5 rounded-full bg-[#10b981] shadow-[0_0_0_3px_rgba(16,185,129,0.18)]"
                aria-hidden="true"
              />
              Managed WhatsApp automation
            </span>

            {/* Sized to hold the whole headline on one line from tablet up: the
                copy column is wide enough that the clamp never has to wrap. */}
            <h1 className="text-[clamp(2rem,5.2vw,4.25rem)] font-semibold leading-[1.05] tracking-[-0.04em] text-balance text-[#1e1811]">
              Your WhatsApp channel,{" "}
              <span className="bg-linear-to-r from-[#ea580c] via-[#c78b34] to-[#059669] bg-clip-text text-transparent">
                run properly
              </span>
              .
            </h1>

            <p className="max-w-xl text-sm leading-relaxed text-[#5c5143] sm:text-[15.5px]">
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
                className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-[#e2d3ba] bg-[#fffdf8]/80 px-8 text-[15px] font-medium tracking-[-0.02em] text-[#1e1811] shadow-xs backdrop-blur-sm transition-all duration-200 hover:border-[#c78b34]/60 hover:bg-[#f5ead6]/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a2681c]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#fbf7ef] sm:w-auto"
              >
                Log in to your workspace
              </Link>
            </div>

            <p className="text-[12px] font-medium text-[#6e6152]">
              No card required · Live in 24 hours · Cancel anytime
            </p>
          </AnimatedGroup>

          {/* The device is taller than its box: the sheet crops it, and the mask
              dissolves the cut so it reads as sliding out of frame. */}
          <div className="relative mx-auto mt-12 w-[clamp(256px,66vw,384px)] sm:mt-14">
            {/* Warm gold & peach aura behind the device, anchored to it so the
                titanium frame pops against the soft cream backdrop. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -inset-x-28 -top-14 bottom-20 -z-10 bg-[radial-gradient(52%_52%_at_50%_45%,rgba(234,88,12,0.18)_0%,rgba(247,215,151,0.38)_48%,transparent_78%)]"
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
