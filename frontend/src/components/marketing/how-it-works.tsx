import { Reveal } from "@/components/marketing/reveal";

const STEPS = [
  {
    title: "Pick your plan",
    detail:
      "Starter, Growth or Business, with the modules built in. The first month and the one time setup fee are charged together.",
  },
  {
    title: "We set it up with you",
    detail:
      "On site: the Meta app and developer account, the number on the Cloud API, the card on your own WhatsApp account, and your first templates.",
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
      data-theme="band"
      className="scroll-mt-24 border-b border-border bg-background"
    >
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
        <Reveal>
          <p className="caption-3 text-brand">How it works</p>
          <h2 className="heading-2 mt-4 max-w-[680px]">
            From the first payment to the first campaign, in three steps
          </h2>
        </Reveal>

        <ol className="mt-12 grid gap-8 md:grid-cols-3 md:gap-4">
          {STEPS.map((step, index) => (
            <li key={step.title} className="h-full">
              <Reveal className="h-full" delay={index * 0.08}>
                <div className="flex h-full flex-col">
                  <span className="title-4 inline-flex size-8 items-center justify-center rounded-full bg-brand text-brand-foreground">
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
            Live the same day, once the Meta app, the number and the payment
            method are in place.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
