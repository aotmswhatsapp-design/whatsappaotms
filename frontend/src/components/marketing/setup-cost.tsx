import { CheckCircle, Receipt } from "@phosphor-icons/react/dist/ssr";

import { Reveal } from "@/components/marketing/reveal";
import { plans } from "@/config/plans";
import { setup } from "@/config/setup";

/**
 * The one time setup fee, directly under the plans so the recurring price is
 * never mistaken for the whole cost of getting started.
 */
export function SetupCost() {
  const planNames = plans.map((plan) => plan.name).join(", ");

  return (
    <section
      id="setup"
      className="scroll-mt-24 border-b border-border bg-secondary"
    >
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
        <Reveal>
          <p className="caption-3 text-brand">Setup</p>
          <h2 className="heading-2 mt-4 max-w-[680px]">
            One setup fee. Then just the plan.
          </h2>
          <p className="title-2 mt-6 max-w-[680px] text-muted-foreground">
            ₹{setup.fee} is charged once, when we build your workspace. Meta
            verification, number onboarding and your first templates are part of
            it.
          </p>
        </Reveal>

        <div className="mt-12 grid items-start gap-4 lg:grid-cols-5">
          <Reveal className="lg:col-span-2">
            <div className="flex flex-col rounded-2xl border border-brand bg-card p-6">
              <div className="flex items-center justify-between gap-4">
                <span className="inline-flex size-10 items-center justify-center rounded-full bg-brand-soft text-brand">
                  <Receipt
                    className="size-5"
                    weight="bold"
                    aria-hidden="true"
                  />
                </span>
                <span className="caption-3 rounded-full bg-brand px-2 py-1 text-white">
                  One time
                </span>
              </div>

              <p className="heading-3 mt-6 tabular-nums">₹{setup.fee}</p>
              <p className="caption-5 mt-1 text-muted-foreground">
                plus {setup.gstPercent}% GST, charged with your first invoice
              </p>

              <dl className="mt-8 flex flex-col gap-3">
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="body-5 text-muted-foreground">Applies to</dt>
                  <dd className="body-5 text-right">{planNames}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="body-5 text-muted-foreground">
                    Repeat charge
                  </dt>
                  <dd className="body-5 text-right">None, ever</dd>
                </div>
              </dl>
            </div>
          </Reveal>

          <Reveal className="lg:col-span-3" delay={0.1}>
            <div className="flex flex-col rounded-2xl border border-border bg-card p-6">
              <h3 className="heading-5">What the setup covers</h3>
              <p className="body-3 mt-2 text-muted-foreground">
                Done by our team, not yours.
              </p>

              <ul className="mt-6 flex flex-col gap-4">
                {setup.includes.map((item) => (
                  <li key={item.title} className="flex gap-3">
                    <CheckCircle
                      className="mt-0.5 size-5 shrink-0 text-brand"
                      weight="fill"
                      aria-hidden="true"
                    />
                    <div>
                      <p className="body-4">{item.title}</p>
                      <p className="body-6 mt-1 text-muted-foreground">
                        {item.detail}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
