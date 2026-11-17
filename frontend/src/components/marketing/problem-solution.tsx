import { CheckCircle, XCircle } from "@phosphor-icons/react/dist/ssr";

import { Reveal } from "@/components/marketing/reveal";

/** What stalls a first launch, and what we take off the customer's desk. */
const WITHOUT = [
  "Business verification, number requests and document uploads sit in your queue.",
  "A template is rejected and nobody can say which line broke the policy.",
  "Campaigns, replies and follow ups live in three different tabs.",
];

const WITH = [
  "We verify the business and connect the number before you log in.",
  "Your first templates are written by us and submitted to Meta for approval.",
  "Campaigns, the shared inbox and analytics share one workspace.",
];

export function ProblemSolution() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
        <Reveal>
          <h2 className="heading-2 max-w-[680px]">
            The setup is the hard part. We take it from here.
          </h2>
          <p className="title-2 mt-6 max-w-[680px] text-muted-foreground">
            The product is the easy half. Verification, number onboarding and
            template approval are what stop a first launch, so they are the
            first things we do for you.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-4 md:grid-cols-2">
          <Reveal className="h-full">
            <div className="flex h-full flex-col rounded-2xl bg-secondary p-6">
              <h3 className="heading-4 text-muted-foreground">On your own</h3>
              <ul className="mt-6 flex flex-col gap-4">
                {WITHOUT.map((item) => (
                  <li key={item} className="flex gap-3">
                    <XCircle
                      className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                      weight="fill"
                      aria-hidden="true"
                    />
                    <p className="body-3 text-muted-foreground">{item}</p>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>

          <Reveal className="h-full" delay={0.1}>
            <div className="flex h-full flex-col rounded-2xl border border-border bg-card p-6">
              <h3 className="heading-4">With AOTMS</h3>
              <ul className="mt-6 flex flex-col gap-4">
                {WITH.map((item) => (
                  <li key={item} className="flex gap-3">
                    <CheckCircle
                      className="mt-0.5 size-5 shrink-0 text-brand"
                      weight="fill"
                      aria-hidden="true"
                    />
                    <p className="body-3">{item}</p>
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
