import type { Metadata } from "next";

export const metadata: Metadata = { title: "Refund and cancellation policy" };

export default function RefundPolicyPage() {
  return (
    <section className="mx-auto w-full max-w-3xl px-5 py-20 lg:px-8">
      <p className="text-xs font-semibold tracking-[0.14em] text-brand uppercase">
        Legal
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
        Refund and cancellation policy
      </h1>
      <p className="mt-4 text-sm text-muted-foreground">
        Last updated: to be set at launch.
      </p>
      <div className="mt-8 space-y-4 text-sm leading-relaxed text-muted-foreground">
        <p>
          This page is scaffolding. The final policy will define the cancellation
          window, refund eligibility, how subscription expiry and grace periods
          interact with cancellation, and the data export window before a
          workspace is deleted.
        </p>
      </div>
    </section>
  );
}
