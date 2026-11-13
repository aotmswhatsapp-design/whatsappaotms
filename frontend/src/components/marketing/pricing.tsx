"use client";

import * as React from "react";
import { motion } from "motion/react";
import NumberFlow from "@number-flow/react";
import confetti from "canvas-confetti";
import { Check, Star } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export interface PricingPlan {
  name: string;
  price: string;
  yearlyPrice: string;
  period: string;
  features: string[];
  description: string;
  buttonText: string;
  href: string;
  isPopular: boolean;
}

interface PricingProps {
  plans: PricingPlan[];
  title?: string;
  description?: string;
}

/**
 * Billing toggle. Monthly by default; annual is charged yearly at 20% off, so
 * `yearlyPrice` is the monthly-equivalent figure — not the annual total.
 */
const CONFETTI_COLORS = ["#ea580c", "#2563eb", "#65a30d", "#111111"];

export function Pricing({
  plans,
  title = "Simple, transparent pricing",
  description = "Every plan includes a dedicated database, the shared inbox and WhatsApp Cloud API access.\nPrices are in INR and exclude 18% GST.",
}: PricingProps) {
  const [isMonthly, setIsMonthly] = React.useState(true);
  const toggleRef = React.useRef<HTMLSpanElement>(null);

  const handleToggle = (checked: boolean) => {
    setIsMonthly(!checked);

    const node = toggleRef.current;
    if (!checked || !node) return;

    const rect = node.getBoundingClientRect();
    confetti({
      particleCount: 50,
      spread: 60,
      origin: {
        x: (rect.left + rect.width / 2) / window.innerWidth,
        y: (rect.top + rect.height / 2) / window.innerHeight,
      },
      colors: CONFETTI_COLORS,
      ticks: 200,
      gravity: 1.2,
      decay: 0.94,
      startVelocity: 30,
      shapes: ["circle"],
    });
  };

  return (
    <section id="plans" className="mx-auto w-full max-w-7xl px-5 py-20 lg:px-8">
      <div className="mx-auto max-w-2xl space-y-4 text-center">
        <p className="text-xs font-semibold tracking-[0.14em] text-brand uppercase">
          Pricing
        </p>
        <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {title}
        </h2>
        <p className="whitespace-pre-line text-lg leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>

      <div className="mt-10 mb-12 flex items-center justify-center gap-3">
        <Label
          htmlFor="billing-cycle"
          className={cn(
            "text-sm transition-colors",
            isMonthly ? "text-foreground" : "text-muted-foreground"
          )}
        >
          Monthly
        </Label>
        <span ref={toggleRef}>
          <Switch
            id="billing-cycle"
            checked={!isMonthly}
            onCheckedChange={handleToggle}
            aria-label="Bill annually instead of monthly"
          />
        </span>
        <Label
          htmlFor="billing-cycle"
          className={cn(
            "text-sm transition-colors",
            isMonthly ? "text-muted-foreground" : "text-foreground"
          )}
        >
          Annual <span className="font-semibold text-brand">(save 20%)</span>
        </Label>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        {plans.map((plan, index) => (
          <motion.div
            key={plan.name}
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{
              duration: 0.55,
              delay: index * 0.1,
              ease: [0.16, 1, 0.3, 1],
            }}
            className={cn(
              "relative flex flex-col rounded-2xl border bg-background p-6 text-center",
              plan.isPopular
                ? "border-2 border-brand md:-mt-5 md:pb-8"
                : "border-border"
            )}
          >
            {plan.isPopular && (
              <div className="absolute top-0 right-0 flex items-center gap-1 rounded-bl-xl rounded-tr-xl bg-brand px-2.5 py-1">
                <Star className="size-3.5 fill-current text-white" />
                <span className="text-xs font-semibold text-white">Popular</span>
              </div>
            )}

            <div className="flex flex-1 flex-col">
              <p className="text-sm font-semibold text-muted-foreground">
                {plan.name}
              </p>

              <div className="mt-6 flex items-center justify-center gap-x-1.5">
                <span className="text-5xl font-bold tracking-tight text-foreground tabular-nums">
                  <NumberFlow
                    value={
                      isMonthly ? Number(plan.price) : Number(plan.yearlyPrice)
                    }
                    locales="en-IN"
                    format={{
                      style: "currency",
                      currency: "INR",
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 0,
                    }}
                    transformTiming={{ duration: 500, easing: "ease-out" }}
                    willChange
                  />
                </span>
                <span className="text-sm font-semibold leading-6 tracking-wide text-muted-foreground">
                  / {plan.period}
                </span>
              </div>

              <p className="text-xs leading-5 text-muted-foreground">
                {isMonthly ? "billed monthly" : "billed annually"}
              </p>

              <ul className="mt-6 flex flex-col gap-2.5">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-brand" />
                    <span className="text-left text-sm leading-relaxed">
                      {feature}
                    </span>
                  </li>
                ))}
              </ul>

              {/* `mt-auto` pins the divider, CTA and footnote to the bottom of
                  every card so the buttons line up across a row. */}
              <hr className="mt-auto mb-5 w-full border-border" />

              <Link
                href={plan.href}
                className={cn(
                  buttonVariants({
                    variant: plan.isPopular ? "brand" : "outline",
                  }),
                  "w-full"
                )}
              >
                {plan.buttonText}
              </Link>

              <p className="mt-5 text-xs leading-5 text-muted-foreground">
                {plan.description}
              </p>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
