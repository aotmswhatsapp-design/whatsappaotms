"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { ArrowRight, BadgeIndianRupee, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { plans } from "@/config/plans";
import { setup } from "@/config/setup";

/**
 * The one-time setup fee, sitting directly under the plans so the recurring
 * price is never mistaken for the whole cost of getting started.
 *
 * Every card reveals on its own, matching HowItWorks and Pricing, and each
 * element starts visible under `prefers-reduced-motion` because Motion skips
 * the transform there.
 */
export function SetupCost() {
  const planNames = plans.map((plan) => plan.name).join(", ");

  return (
    <section id="setup" className="mx-auto w-full max-w-7xl px-5 py-20 lg:px-8">
      <div className="mx-auto max-w-2xl space-y-4 text-center">
        <p className="text-xs font-semibold tracking-[0.14em] text-brand uppercase">
          Setup
        </p>
        <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          One setup fee. Then just the plan.
        </h2>
        <p className="text-lg leading-relaxed text-muted-foreground">
          ₹{setup.fee} is charged once, when we build your workspace — Meta
          verification, number onboarding and your first templates are part of
          it.
        </p>
      </div>

      <div className="mt-12 grid gap-5 lg:grid-cols-5">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="relative flex flex-col rounded-2xl border-2 border-brand bg-background p-6 sm:p-8 lg:col-span-2"
        >
          <div className="flex items-center justify-between gap-4">
            <span className="inline-flex size-10 items-center justify-center rounded-xl bg-brand-soft text-brand">
              <BadgeIndianRupee className="size-5" />
            </span>
            <span className="rounded-full bg-brand px-2.5 py-1 text-xs font-semibold text-white">
              One-time
            </span>
          </div>

          <p className="mt-6 text-sm font-semibold text-muted-foreground">
            Setup cost
          </p>

          <div className="mt-2 flex items-end gap-x-1.5">
            <span className="text-5xl font-bold tracking-tight text-foreground tabular-nums">
              ₹{setup.fee}
            </span>
            <span className="pb-1.5 text-sm font-semibold text-muted-foreground">
              / one-time
            </span>
          </div>

          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Charged once, with your first invoice. Renewals never repeat it.
          </p>

          {/* `mt-auto` pins the divider and breakdown to the bottom so this card
              ends level with the taller checklist beside it. */}
          <div className="mt-auto pt-6">
            <hr className="border-border" />

            <dl className="mt-6 flex flex-col gap-3 text-sm">
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-muted-foreground">Applies to</dt>
                <dd className="text-right font-medium">{planNames}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-muted-foreground">GST</dt>
                <dd className="text-right font-medium">
                  +{setup.gstPercent}%
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-muted-foreground">Repeat charge</dt>
                <dd className="text-right font-medium text-lime">
                  None, ever
                </dd>
              </div>
            </dl>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-col rounded-2xl border border-border bg-card p-6 sm:p-8 lg:col-span-3"
        >
          <h3 className="text-base font-semibold">What the setup covers</h3>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Done by our team, not yours.
          </p>

          <ul className="mt-6 flex flex-col gap-4">
            {setup.includes.map((item) => (
              <li key={item.title} className="flex gap-3">
                <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">
                  <Check className="size-3" strokeWidth={3} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{item.title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                    {item.detail}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </motion.div>
      </div>

      <div className="mt-10 flex flex-col items-start gap-4 border-t border-border pt-8 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
          Nothing to install, and no migration work on your side. If you already
          run a WhatsApp Business account, we connect it as it is.
        </p>
        <Button asChild variant="brand" size="lg" className="shrink-0">
          <Link href="/#plans">
            See the plans
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      </div>
    </section>
  );
}
