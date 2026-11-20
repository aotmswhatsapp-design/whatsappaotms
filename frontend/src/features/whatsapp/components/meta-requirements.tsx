"use client";

import type { ReactNode } from "react";
import { BookOpen } from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

/**
 * The Meta side of the setup, in the order it has to happen.
 *
 * Everything here belongs to the account that owns the number, so it happens
 * in Meta's own dashboard and never on this page. Items are collapsible
 * because the screen should help when asked, not read like a manual.
 */
const ITEMS: { value: string; title: string; body: ReactNode }[] = [
  {
    value: "app",
    title: "The Meta app",
    body: (
      <ul className="space-y-1.5">
        <li>
          developers.facebook.com → My Apps → Create app → the
          &quot;WhatsApp&quot; use case. The app has to belong to the business
          that owns the number.
        </li>
        <li>
          Three permissions are added by default:{" "}
          <code className="font-mono text-[12px]">public_profile</code>,{" "}
          <code className="font-mono text-[12px]">
            whatsapp_business_management
          </code>{" "}
          and{" "}
          <code className="font-mono text-[12px]">
            whatsapp_business_messaging
          </code>
          .
        </li>
        <li>
          No App Review and no Live switch are needed: the app only touches
          assets its own business owns, so Development mode is enough.
        </li>
      </ul>
    ),
  },
  {
    value: "token",
    title: "A permanent access token",
    body: (
      <ul className="space-y-1.5">
        <li>
          Business settings → Users → System users → add a system user → assign
          the WhatsApp account → generate a token with both WhatsApp permissions.
        </li>
        <li>
          A system user token does not expire the way a personal token does, so
          the connection cannot die in sixty days.
        </li>
        <li>
          Treat it as a password: this form encrypts it at rest and never shows
          more than its last four characters.
        </li>
      </ul>
    ),
  },
  {
    value: "webhook",
    title: "Webhook, verify token and app secret",
    body: (
      <ul className="space-y-1.5">
        <li>
          WhatsApp → Configuration → Webhook: paste the callback URL shown above
          and the <code className="font-mono text-[12px]">wa_…</code> verify
          token this workspace generated, then Verify and save.
        </li>
        <li>
          Subscribe to the{" "}
          <code className="font-mono text-[12px]">messages</code> field; that is
          the event the inbox counts. Account alerts are worth subscribing too,
          because they warn before Meta stops delivering.
        </li>
        <li>
          App settings → Basic → App secret is what proves a delivery was signed
          by Meta, so it is asked for in the form as well.
        </li>
      </ul>
    ),
  },
  {
    value: "payment",
    title: "A payment method (mandatory)",
    body: (
      <ul className="space-y-1.5">
        <li>
          Meta bills every template, and since 1 October 2026 every service
          reply, to the WhatsApp Business account that sends it. The card lives
          on that account; this platform never handles it.
        </li>
        <li>
          Meta Business Suite →{" "}
          <a
            className="underline underline-offset-2"
            href="https://business.facebook.com/latest/billing_hub/payment_methods/"
            rel="noreferrer"
            target="_blank"
          >
            Billing &amp; payments → Payment methods
          </a>{" "}
          → add the card. Without one, messages stop being delivered.
        </li>
        <li>
          The first 1,000 service messages per number per month are free, and
          inbound messages are always free.
        </li>
      </ul>
    ),
  },
  {
    value: "verification",
    title: "Number and business verification",
    body: (
      <ul className="space-y-1.5">
        <li>
          The number must not be active on the WhatsApp app. Delete it there
          before registering it on the Cloud API.
        </li>
        <li>
          Business settings → Business info → verify the business. Meta wants
          the legal name, address and documents that tie the business to the
          account.
        </li>
        <li>
          Verification is not needed to send the first message, but it gates the
          higher messaging and phone number limits, so start it early.
        </li>
      </ul>
    ),
  },
];

export function MetaRequirements() {
  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
        <BookOpen className="size-4 text-muted-foreground" aria-hidden="true" />
        What Meta requires
      </h2>
      <p className="mt-1 text-[13.5px] leading-relaxed text-muted-foreground">
        These happen inside Meta&apos;s dashboard, once per client, and none of
        them happen on this page. The form above only verifies what you
        collected.
      </p>

      <Accordion className="mt-1" collapsible type="single">
        {ITEMS.map((item) => (
          <AccordionItem key={item.value} value={item.value}>
            <AccordionTrigger className="py-3 text-[14px]">
              {item.title}
            </AccordionTrigger>
            <AccordionContent className="pb-3 text-[13.5px] leading-relaxed text-muted-foreground">
              {item.body}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}
