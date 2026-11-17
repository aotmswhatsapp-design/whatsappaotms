import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Reveal } from "@/components/marketing/reveal";
import { site } from "@/config/site";
import { faqs } from "@/config/faq";

/** Objection handling. The questions are the ones people ask before paying. */
export function Faq() {
  return (
    <section id="faq" className="scroll-mt-24 border-b border-border">
      <div className="mx-auto grid w-full max-w-6xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:py-24">
        <Reveal>
          <p className="caption-3 text-brand">FAQ</p>
          <h2 className="heading-2 mt-4 max-w-[680px]">
            Questions people ask before signing up
          </h2>
          <p className="body-3 mt-6 max-w-[680px] text-muted-foreground">
            Still unsure? Write to{" "}
            <a
              href={`mailto:${site.email}`}
              className="rounded-sm font-medium text-brand transition-colors duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              {site.email}
            </a>
            .
          </p>
        </Reveal>

        <Reveal delay={0.1}>
          <Accordion type="single" collapsible className="w-full">
            {faqs.map((faq, index) => (
              <AccordionItem key={faq.question} value={`item-${index}`}>
                <AccordionTrigger className="title-3 text-left">
                  {faq.question}
                </AccordionTrigger>
                <AccordionContent className="body-6 text-muted-foreground">
                  {faq.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </Reveal>
      </div>
    </section>
  );
}
