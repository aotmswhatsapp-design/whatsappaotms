"use client";

import * as React from "react";
import { CheckCircle, Minus } from "@phosphor-icons/react";

import { CtaLink } from "@/components/marketing/cta-link";
import { annualDiscountPercent, plans } from "@/config/pricing";
import { cn } from "@/lib/utils";

export interface PricingPlan {
  name: string;
  price: string;
  yearlyPrice: string;
  yearlyTotal: string;
  yearlySaving: string;
  period: string;
  description: string;
  features: string[];
  modules: { name: string; included: boolean }[];
  buttonText: string;
  href: string;
  isPopular: boolean;
}

/**
 * `price` is the monthly price and `yearlyPrice` the monthly equivalent when
 * billed annually, so both render as `₹x / month`. In annual mode the yearly
 * amount is printed on its own line underneath, because it is twelve of those
 * months at once and must not be mistaken for the monthly figure.
 */
const formatPrice = (value: string) => Number(value).toLocaleString("en-IN");

/**
 * Three plans, one card each. The workspace is the same in all of them, so the
 * cards differ by the modules they unlock rather than by a second price list.
 * Meta's per-message charges are explained in their own block instead of being
 * priced here, because Meta bills them to the client's own account.
 */
export function Pricing() {
  const [annual, setAnnual] = React.useState(false);

  return (
    <section
      id="plans"
      className="scroll-mt-24 border-b border-border bg-background text-foreground"
    >
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
        <div className="mx-auto max-w-[680px] text-center">
          <p className="caption-3 text-brand">Pricing</p>
          <h2 className="heading-2 mt-4">One platform fee. Three plans.</h2>
          <p className="body-2 mt-6 text-muted-foreground">
            The platform fee is the same in all three: the workspace, the inbox,
            your contacts, your team and the WhatsApp connection. Starter,
            Growth and Business differ by the modules they unlock.
            WhatsApp&apos;s own message charges are billed by Meta to your
            account, and never marked up here.
          </p>
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
              <span className="ml-1 text-brand">
                save {annualDiscountPercent}%
              </span>
            </button>
          </div>
        </div>

        <div className="mt-12 grid items-stretch gap-5 lg:grid-cols-3">
          {plans.map((plan) => {
            const moduleCount = plan.modules.filter(
              (module) => module.included,
            ).length;

            return (
              <article
                key={plan.name}
                className={cn(
                  "flex h-full flex-col rounded-2xl border bg-card p-6 sm:p-7",
                  plan.isPopular ? "border-brand" : "border-border",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="title-1">{plan.name}</h3>
                  {plan.isPopular ? (
                    <span className="caption-3 rounded-full bg-brand-soft px-2 py-1 text-brand">
                      Most popular
                    </span>
                  ) : null}
                </div>
                <p className="body-6 mt-2 text-muted-foreground">
                  {plan.description}
                </p>

                <p className="heading-3 mt-6 tabular-nums">
                  ₹{formatPrice(annual ? plan.yearlyPrice : plan.price)}
                  <span className="body-6 text-muted-foreground">
                    {" "}
                    / {plan.period}
                  </span>
                </p>
                {/* The yearly amount sits on its own line: it is not a
                    per-month figure and must not read as one. */}
                {annual ? (
                  <p className="caption-5 mt-1 text-muted-foreground">
                    ₹{formatPrice(plan.yearlyTotal)} billed yearly · you save ₹
                    {formatPrice(plan.yearlySaving)}
                  </p>
                ) : (
                  <p className="caption-5 mt-1 text-muted-foreground">
                    billed monthly
                  </p>
                )}

                <CtaLink
                  className="mt-6 w-full"
                  href={plan.href}
                  variant={plan.isPopular ? "brand" : "outline"}
                >
                  {plan.buttonText}
                </CtaLink>

                <ul className="mt-7 flex flex-col gap-2.5 border-t border-border pt-6">
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

                <div className="mt-auto pt-6">
                  <div className="flex items-baseline justify-between gap-3 border-t border-border pt-5">
                    <p className="caption-3 text-muted-foreground">Modules</p>
                    <p className="caption-4 text-muted-foreground">
                      {moduleCount} of {plan.modules.length}
                    </p>
                  </div>
                  <ul className="mt-3 flex flex-col gap-2">
                    {plan.modules.map((module) => (
                      <li key={module.name} className="flex gap-2">
                        {module.included ? (
                          <CheckCircle
                            className="mt-0.5 size-3.5 shrink-0 text-brand"
                            weight="fill"
                            aria-hidden="true"
                          />
                        ) : (
                          <Minus
                            className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/60"
                            aria-hidden="true"
                          />
                        )}
                        <span
                          className={cn(
                            "body-6",
                            module.included
                              ? "text-foreground"
                              : "text-muted-foreground/70",
                          )}
                        >
                          {module.name}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </article>
            );
          })}
        </div>

        <div className="mt-10 rounded-2xl border border-border bg-secondary p-5 sm:p-6">
          <h3 className="title-2">
            WhatsApp message charges are Meta&apos;s, not ours
          </h3>
          <p className="body-5 mt-2 text-muted-foreground">
            Meta bills every template — marketing, utility and authentication —
            and since 1 October 2026 every service reply, to the WhatsApp
            Business account that sends it. The card for those charges is
            registered in your own Meta account, and Meta invoices you directly.
            These rates are Meta&apos;s: this platform does not resell them, add
            a margin, or hold your card. The first 1,000 service messages per
            number per month are free, and inbound messages are always free.
          </p>
        </div>

        <div className="mt-8">
          <p className="caption-2 text-center text-muted-foreground">
            Prices are in INR and exclude 18% GST. The one time setup fee is
            billed once, with your first invoice.
          </p>
          <p className="caption-2 mt-2 text-center text-muted-foreground">
            Annual billing takes {annualDiscountPercent}% off every plan and is
            charged once a year. Moving up a plan does not charge the setup fee
            again.
          </p>
          <p className="caption-2 mt-2 text-center text-muted-foreground">
            Each plan covers one WhatsApp number. A second number runs in its
            own workspace, on its own plan.
          </p>
        </div>
      </div>
    </section>
  );
}
