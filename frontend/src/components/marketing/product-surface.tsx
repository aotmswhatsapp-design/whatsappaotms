import type { ReactNode } from "react";

import { Reveal } from "@/components/marketing/reveal";

const BARS = ["h-6", "h-10", "h-4", "h-12", "h-8", "h-10", "h-12"];

function Panel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-6 rounded-xl bg-secondary p-4">
      <p className="caption-5 text-muted-foreground">{label}</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

/** Four surfaces, each shown as a small still of the workspace. */
export function ProductSurface() {
  return (
    <section id="product" className="scroll-mt-24 border-b border-border">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
        <Reveal>
          <p className="caption-3 text-brand">Inside the workspace</p>
          <h2 className="heading-2 mt-4 max-w-[680px]">
            The four screens you will actually live in
          </h2>
          <p className="title-2 mt-6 max-w-[680px] text-muted-foreground">
            Nothing is bolted on. Campaigns, replies, chatbot replies and the
            numbers behind them are the same workspace.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-4 md:grid-cols-2">
          <Reveal className="h-full">
            <article className="flex h-full flex-col rounded-2xl border border-border p-6">
              <h3 className="heading-6">Campaigns</h3>
              <p className="body-3 mt-2 text-muted-foreground">
                Build a send from an approved template, pick a segment and
                review it before anything leaves.
              </p>
              <Panel label="Scheduled today">
                <ul className="flex flex-col gap-3">
                  {["Order updates", "Reengagement", "First response"].map(
                    (name) => (
                      <li key={name} className="flex items-center gap-3">
                        <span
                          aria-hidden="true"
                          className="size-2 rounded-full bg-brand"
                        />
                        <span className="body-6 flex-1">{name}</span>
                        <span className="caption-5 text-muted-foreground">
                          Queued
                        </span>
                      </li>
                    ),
                  )}
                </ul>
              </Panel>
            </article>
          </Reveal>

          <Reveal className="h-full" delay={0.05}>
            <article className="flex h-full flex-col rounded-2xl border border-border p-6">
              <h3 className="heading-6">Shared inbox</h3>
              <p className="body-3 mt-2 text-muted-foreground">
                Campaign replies and new messages land in one queue, assigned to
                whoever is on shift.
              </p>
              <Panel label="Needs a reply">
                <ul className="flex flex-col gap-3">
                  {[
                    "Where is my order?",
                    "Do you ship to Pune?",
                    "Change the delivery address",
                  ].map((message) => (
                    <li key={message} className="flex items-center gap-3">
                      <span
                        aria-hidden="true"
                        className="size-2 rounded-full bg-blue"
                      />
                      <span className="body-6 flex-1">{message}</span>
                      <span className="caption-5 text-muted-foreground">
                        New
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            </article>
          </Reveal>

          <Reveal className="h-full" delay={0.1}>
            <article className="flex h-full flex-col rounded-2xl border border-border p-6">
              <h3 className="heading-6">Chatbot</h3>
              <p className="body-3 mt-2 text-muted-foreground">
                Routine questions get an approved answer straight away, and
                anything else goes to a person.
              </p>
              <Panel label="Delivery questions">
                <ol className="flex flex-col gap-3">
                  {[
                    "Customer asks about delivery",
                    "Reply with the approved tracking template",
                    "Assign to an agent if they reply again",
                  ].map((step, index) => (
                    <li key={step} className="flex items-start gap-3">
                      <span className="caption-5 inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-lime-soft text-foreground">
                        {index + 1}
                      </span>
                      <span className="body-6">{step}</span>
                    </li>
                  ))}
                </ol>
              </Panel>
            </article>
          </Reveal>

          <Reveal className="h-full" delay={0.15}>
            <article className="flex h-full flex-col rounded-2xl border border-border p-6">
              <h3 className="heading-6">Analytics</h3>
              <p className="body-3 mt-2 text-muted-foreground">
                Delivery, read and reply counts next to the campaign that
                produced them, not in a separate report.
              </p>
              <Panel label="Last seven campaigns">
                <div
                  aria-hidden="true"
                  className="flex h-12 items-end gap-2"
                >
                  {BARS.map((height, index) => (
                    <span
                      key={index}
                      className={`w-3 rounded-full ${
                        index === BARS.length - 1 ? "bg-brand" : "bg-brand/20"
                      } ${height}`}
                    />
                  ))}
                </div>
              </Panel>
            </article>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
