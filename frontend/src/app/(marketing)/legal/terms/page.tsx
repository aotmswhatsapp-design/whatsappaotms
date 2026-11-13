import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms and conditions" };

export default function TermsPage() {
  return (
    <section className="mx-auto w-full max-w-3xl px-5 py-20 lg:px-8">
      <p className="text-xs font-semibold tracking-[0.14em] text-brand uppercase">
        Legal
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
        Terms and conditions
      </h1>
      <p className="mt-4 text-sm text-muted-foreground">
        Last updated: to be set at launch.
      </p>
      <div className="mt-8 space-y-4 text-sm leading-relaxed text-muted-foreground">
        <p>
          This page is scaffolding. The final terms will cover subscription
          scope, acceptable use of the WhatsApp Business API, customer
          obligations around consent and opt-out, service availability, and
          limitation of liability.
        </p>
        <p>
          Counsel-reviewed copy must replace this placeholder before any paid
          customer is onboarded.
        </p>
      </div>
    </section>
  );
}
