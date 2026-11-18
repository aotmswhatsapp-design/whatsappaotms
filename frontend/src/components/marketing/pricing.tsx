"use client";

import * as React from "react";
import { CheckCircle } from "@phosphor-icons/react";

import { CtaLink } from "@/components/marketing/cta-link";
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
 * `yearlyPrice` is the monthly equivalent when billed annually, not the annual
 * total, so both figures render as `₹x / month`.
 */
const formatPrice = (value: string) => Number(value).toLocaleString("en-IN");

export function Pricing({
  plans,
  title = "Simple, transparent pricing",
  description = "Every plan includes the shared inbox, campaigns, chatbot flows and analytics. Change plan whenever you need more room.",
}: PricingProps) {
  const [annual, setAnnual] = React.useState(false);

  return (
    /* Back on the deep field. The product band above stays paper, so the page
       alternates instead of running two light sections together, and the plans
       are raised teal cards with the accent on the popular one. */
    <section
      id="plans"
      className="scroll-mt-24 border-b border-border bg-background text-foreground"
    >
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
        <div className="mx-auto max-w-[680px] text-center">
          <p className="caption-3 text-brand">Plans</p>
          <h2 className="heading-2 mt-4">{title}</h2>
          <p className="body-2 mt-6 text-muted-foreground">{description}</p>
        </div>

        <div className="mt-8 flex justify-center">
          <div
            role="group"
            aria-label="Billing cycle"
            className="inline-flex rounded-full border border-border bg-secondary p-1"
          >
            <button
              type="button"
              aria-pressed={!annual}
              onClick={() => setAnnual(false)}
              className={cn(
                "button-sm rounded-full px-3 py-2 transition-colors duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:outline-none",
                annual
                  ? "text-muted-foreground hover:text-foreground"
                  : "bg-foreground text-background shadow-sm",
              )}
            >
              Monthly
            </button>
            <button
              type="button"
              aria-pressed={annual}
              onClick={() => setAnnual(true)}
              className={cn(
                "button-sm rounded-full px-3 py-2 transition-colors duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:outline-none",
                annual
                  ? "bg-foreground text-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Annual
              <span className="ml-1 text-brand">save 20%</span>
            </button>
          </div>
        </div>

        <div className="mt-12 grid gap-4 lg:grid-cols-3">
          {plans.map((plan) => (
            <article
              key={plan.name}
              className={cn(
                "flex flex-col rounded-2xl border bg-card p-6",
                plan.isPopular ? "border-brand" : "border-border",
              )}
            >
              <div className="flex items-center justify-between gap-4">
                <h3 className="title-1">{plan.name}</h3>
                {plan.isPopular ? (
                  <span className="caption-3 rounded-full bg-brand-soft px-2 py-1 text-brand">
                    Popular
                  </span>
                ) : null}
              </div>

              <p className="body-5 mt-2 text-muted-foreground">
                {plan.description}
              </p>

              <p className="heading-3 mt-6 tabular-nums">
                ₹{formatPrice(annual ? plan.yearlyPrice : plan.price)}
                <span className="body-6 text-muted-foreground">
                  {" "}
                  / {plan.period}
                </span>
              </p>
              <p className="caption-5 mt-1 text-muted-foreground">
                {annual ? "billed annually" : "billed monthly"}
              </p>

              <ul className="mt-6 flex flex-col gap-3">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-2">
                    <CheckCircle
                      className="mt-0.5 size-4 shrink-0 text-brand"
                      weight="fill"
                      aria-hidden="true"
                    />
                    <span className="body-5">{feature}</span>
                  </li>
                ))}
              </ul>

              {/* `mt-auto` keeps every button on the same line across the row
                  even when the feature lists differ in length. */}
              <div className="mt-auto pt-8">
                <CtaLink
                  href={plan.href}
                  variant={plan.isPopular ? "brand" : "outline"}
                  className="w-full"
                >
                  {plan.buttonText}
                </CtaLink>
              </div>
            </article>
          ))}
        </div>

        <div className="mt-8">
          <p className="caption-2 text-center text-muted-foreground">
            Prices are in INR and exclude 18% GST. The one time setup fee is
            billed once, with your first invoice.
          </p>
          <p className="caption-2 mt-2 text-center text-muted-foreground">
            Billed monthly. No annual lock in unless you choose it.
          </p>
        </div>
      </div>
    </section>
  );
}
