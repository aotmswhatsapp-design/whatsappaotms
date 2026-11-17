import {
  ChartLineUp,
  ChatsCircle,
  FileText,
  Phone,
} from "@phosphor-icons/react/dist/ssr";

import { Reveal } from "@/components/marketing/reveal";

const BENEFITS = [
  {
    icon: ChatsCircle,
    title: "Every conversation in one place",
    detail:
      "Campaign replies land in the same inbox your team works from, so nothing is forwarded by hand.",
  },
  {
    icon: Phone,
    title: "Your number connected properly",
    detail:
      "The business is verified with Meta and the number is attached to your workspace before the first send.",
  },
  {
    icon: FileText,
    title: "Templates that get approved",
    detail:
      "We write the first set from your offer and submit them, so a rejection does not sit between you and launch.",
  },
  {
    icon: ChartLineUp,
    title: "You can see what landed",
    detail:
      "Delivery, read and reply counts sit next to every campaign instead of in a separate spreadsheet.",
  },
];

export function Benefits() {
  return (
    <section id="benefits" className="scroll-mt-24 border-b border-border">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
        <Reveal>
          <p className="caption-3 text-brand">What changes</p>
          <h2 className="heading-2 mt-4 max-w-[680px]">
            One workspace, from the first message to the report
          </h2>
        </Reveal>

        <div className="mt-12 grid gap-4 md:grid-cols-2">
          {BENEFITS.map((benefit, index) => (
            <Reveal key={benefit.title} className="h-full" delay={index * 0.05}>
              <div className="flex h-full flex-col rounded-2xl border border-border p-6">
                <span className="inline-flex size-10 items-center justify-center rounded-full bg-brand-soft text-brand">
                  <benefit.icon
                    className="size-5"
                    weight="bold"
                    aria-hidden="true"
                  />
                </span>
                <h3 className="heading-6 mt-6">{benefit.title}</h3>
                <p className="body-3 mt-2 text-muted-foreground">
                  {benefit.detail}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
