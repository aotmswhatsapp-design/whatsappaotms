"use client";

import { motion } from "motion/react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCheck,
  CreditCard,
  DatabaseZap,
  Send,
  ShieldCheck,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { site } from "@/config/site";

const steps = [
  {
    icon: CreditCard,
    title: "Pick a plan and pay",
    body: "Razorpay checkout, GST invoice by email. No sales call, no card on file that you cannot cancel.",
    meta: "Takes about a minute",
  },
  {
    icon: DatabaseZap,
    title: "We provision your workspace",
    body: "A dedicated PostgreSQL database is created for you and wired up automatically — you never touch a connection string.",
    meta: "Ready in about 60 seconds",
  },
  {
    icon: ShieldCheck,
    title: "Connect WhatsApp officially",
    body: "Meta's embedded signup links your WhatsApp Business account. Credentials are encrypted at rest and used only on your behalf.",
    meta: "Official Cloud API",
  },
  {
    icon: Send,
    title: "Import contacts and launch",
    body: "Upload a list, submit templates for approval, then send to segments and watch delivery and read rates land live.",
    meta: "Campaigns, inbox, chatbots",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="mx-auto w-full max-w-7xl px-5 py-20 lg:px-8">
      <div className="max-w-2xl">
        <p className="text-xs font-semibold tracking-[0.14em] text-brand uppercase">
          How it works
        </p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          From payment to your first campaign, in one sitting
        </h2>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
          There is nothing to install and no infrastructure to run. You pay, we
          build your workspace, and you start messaging.
        </p>
      </div>

      <ol className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, index) => {
          const Icon = step.icon;

          return (
            <motion.li
              key={step.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.5, delay: index * 0.08, ease: [0.16, 1, 0.3, 1] }}
              className="relative flex flex-col rounded-2xl border border-border bg-card p-6"
            >
              <div className="flex items-center justify-between">
                <span className="inline-flex size-10 items-center justify-center rounded-xl bg-brand-soft text-brand">
                  <Icon className="size-5" />
                </span>
                <span className="text-3xl font-semibold tracking-tight text-border tabular-nums">
                  {String(index + 1).padStart(2, "0")}
                </span>
              </div>

              <h3 className="mt-5 text-base font-semibold">{step.title}</h3>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">
                {step.body}
              </p>
              <p className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-lime">
                <CheckCheck className="size-3.5" />
                {step.meta}
              </p>
            </motion.li>
          );
        })}
      </ol>

      <div className="mt-10 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
        <Button asChild variant="brand" size="lg">
          <Link href="/#plans">
            See the plans
            <ArrowRight className="size-4" />
          </Link>
        </Button>
        <Button asChild variant="ghost" size="lg">
          <a href={`mailto:${site.email}`}>Ask a question first</a>
        </Button>
      </div>
    </section>
  );
}
