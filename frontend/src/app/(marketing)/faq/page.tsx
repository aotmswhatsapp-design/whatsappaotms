import type { Metadata } from "next";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export const metadata: Metadata = { title: "FAQ" };

const faqs = [
  {
    question: "Do I need my own Meta Business account?",
    answer:
      "Yes. You connect your own WhatsApp Business account through Meta's official signup flow, and your credentials are stored encrypted and used only on your behalf.",
  },
  {
    question: "Is my data shared with other customers?",
    answer:
      "No. Every customer gets a separate PostgreSQL database. Your contacts, conversations, and campaign history never sit in a shared store.",
  },
  {
    question: "What happens when my subscription expires?",
    answer:
      "Access is restricted after a grace period, and your data is preserved according to the retention policy. Nothing is deleted the moment a plan lapses.",
  },
  {
    question: "Can I use my own message templates?",
    answer:
      "You create templates in your workspace; they are submitted to Meta for approval and synced back. Campaigns can only use approved templates.",
  },
  {
    question: "How do I invite my team?",
    answer:
      "The workspace owner invites managers and support agents by email. Roles determine what each person can see and change.",
  },
];

export default function FaqPage() {
  return (
    <section className="mx-auto w-full max-w-3xl px-5 py-20 lg:px-8">
      <p className="text-xs font-semibold tracking-[0.14em] text-brand uppercase">
        FAQ
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
        Questions people ask before signing up
      </h1>

      <Accordion type="single" collapsible className="mt-10 w-full">
        {faqs.map((faq, index) => (
          <AccordionItem key={faq.question} value={`item-${index}`}>
            <AccordionTrigger className="text-base">
              {faq.question}
            </AccordionTrigger>
            <AccordionContent className="text-muted-foreground">
              {faq.answer}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}
