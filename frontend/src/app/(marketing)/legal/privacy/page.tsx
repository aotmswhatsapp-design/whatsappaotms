import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy policy" };

export default function PrivacyPage() {
  return (
    <section className="mx-auto w-full max-w-3xl px-5 py-20 lg:px-8">
      <p className="text-xs font-semibold tracking-[0.14em] text-brand uppercase">
        Legal
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
        Privacy policy
      </h1>
      <p className="mt-4 text-sm text-muted-foreground">
        Last updated: to be set at launch.
      </p>
      <div className="mt-8 space-y-4 text-sm leading-relaxed text-muted-foreground">
        <p>
          This page is scaffolding. The final policy will describe what we
          collect during signup and billing, how customer workspace data is
          isolated, how long data is retained after cancellation, and how data
          subject requests are handled.
        </p>
        <p>
          Customer contact and message data belongs to the customer. Payments
          are processed by Razorpay; we do not store card details.
        </p>
      </div>
    </section>
  );
}
