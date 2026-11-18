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
 * The Meta side of the setup, in the order Meta asks for it.
 *
 * Every line here comes from the dashboard Meta shows for this use case, and
 * each item is collapsible: the screen should help when asked, not read like a
 * manual. Required permissions are marked, because adding unneeded ones is what
 * gets an App Review rejected.
 */
const ITEMS: { value: string; title: string; body: ReactNode }[] = [
  {
    value: "permissions",
    title: "App permissions",
    body: (
      <>
        <p>
          Required for any WhatsApp API call, and added to a new app by default:
        </p>
        <ul className="mt-2 space-y-1.5">
          {[
            "public_profile",
            "whatsapp_business_management",
            "whatsapp_business_messaging",
          ].map((permission) => (
            <li key={permission}>
              <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[12px]">
                {permission}
              </code>
            </li>
          ))}
        </ul>
        <p className="mt-2">
          Optional, and only if the product needs them:{" "}
          <code className="font-mono text-[12px]">business_management</code>,{" "}
          <code className="font-mono text-[12px]">email</code>, and{" "}
          <code className="font-mono text-[12px]">whatsapp_business_manage_events</code>{" "}
          (marketing messages only). Unneeded permissions can fail App Review.
        </p>
      </>
    ),
  },
  {
    value: "business",
    title: "Business verification",
    body: (
      <ul className="space-y-1.5">
        <li>Business name, address, phone number, email and website.</li>
        <li>A way for Meta to confirm your connection to the business.</li>
        <li>Documents if the details are not already on file.</li>
        <li>
          Verification comes first: App Review cannot be submitted until it is
          done.
        </li>
      </ul>
    ),
  },
  {
    value: "review",
    title: "App Review",
    body: (
      <ul className="space-y-1.5">
        <li>App icon, privacy policy URL and an app category.</li>
        <li>
          Video evidence of the app sending a message and managing templates.
        </li>
        <li>
          Submit only the permissions the product actually uses; that is what
          reviewers check.
        </li>
      </ul>
    ),
  },
  {
    value: "webhooks",
    title: "Webhook and permanent token",
    body: (
      <ul className="space-y-1.5">
        <li>
          WhatsApp → Configuration → Webhook: paste the callback URL and verify
          token, then Verify and save.
        </li>
        <li>
          Subscribe to the <code className="font-mono text-[12px]">messages</code>{" "}
          field; that is the event this workspace counts.
        </li>
        <li>
          A system user token is the permanent alternative to the short-lived
          test token — the credentials form below accepts it.
        </li>
      </ul>
    ),
  },
  {
    value: "publish",
    title: "Publish the app",
    body: (
      <ul className="space-y-1.5">
        <li>Icon between 512×512 and 1024×1024, under 5 MB.</li>
        <li>A privacy policy URL, plus a data deletion URL or callback.</li>
        <li>App settings → publish. Before this, only test users can connect.</li>
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
        Only the account owner can do these in Meta&apos;s own dashboard. None of
        them happen here, and none of them are needed before you connect.
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
