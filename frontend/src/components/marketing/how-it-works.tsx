import { Reveal } from "@/components/marketing/reveal";

const STEPS = [
  {
    title: "Choose a plan",
    detail:
      "Pick Starter, Growth or Business. The first month and the one time setup fee are charged together.",
  },
  {
    title: "We build the workspace",
    detail:
      "Verification, number onboarding, your first templates and your plan limits are set up by our team.",
  },
  {
    title: "Send your first campaign",
    detail:
      "Import contacts, pick an approved template and send. Your two onboarding calls cover the first campaign.",
  },
];

export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="scroll-mt-24 border-b border-border bg-secondary"
    >
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
        <Reveal>
          <p className="caption-3 text-brand">How it works</p>
          <h2 className="heading-2 mt-4 max-w-[680px]">
            From payment to first campaign, in three steps
          </h2>
        </Reveal>

        <ol className="mt-12 grid gap-8 md:grid-cols-3 md:gap-4">
          {STEPS.map((step, index) => (
            <li key={step.title} className="h-full">
              <Reveal className="h-full" delay={index * 0.08}>
                <div className="flex h-full flex-col">
                  <span className="title-4 inline-flex size-8 items-center justify-center rounded-full bg-brand text-white">
                    {index + 1}
                  </span>
                  <h3 className="heading-6 mt-4">{step.title}</h3>
                  <p className="body-3 mt-2 text-muted-foreground">
                    {step.detail}
                  </p>
                </div>
              </Reveal>
            </li>
          ))}
        </ol>

        <Reveal delay={0.16}>
          <p className="body-4 mt-12 text-muted-foreground">
            Live within 24 hours, measured from the payment clearing.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
