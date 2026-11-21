"use client";

import * as React from "react";
import Image from "next/image";
import { CheckCircle } from "@phosphor-icons/react/dist/ssr";

import { Reveal } from "@/components/marketing/reveal";
import { industries } from "@/config/industries";
import { cn } from "@/lib/utils";

const EASE =
  "transition-colors duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]";
const FOCUS =
  "focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:outline-none";

/** One panel whose label changes, so `aria-controls` never points at nothing. */
const PANEL_ID = "industry-panel";
const tabId = (id: string) => `industry-tab-${id}`;

const MOVES: Record<string, number> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

/**
 * The industries block: one centred header, a row of pills, and a card that
 * swaps its copy and illustration to match the pill in focus.
 *
 * This is the one interactive section on the page that ships its own state, so
 * it is a client island like the price toggle. Everything it renders comes from
 * `config/industries`, which means a new industry is one PNG plus one entry.
 *
 * The illustrations are photographs cut out onto white. Multiplied against the
 * card's tint the white disappears and the picture sits on the card, and the
 * fixed aspect box means swapping between a 1024x796 file and a 1130x944 one
 * never changes the card's height.
 */
export function Industries() {
  const [activeId, setActiveId] = React.useState(industries[0].id);
  const tabs = React.useRef<Array<HTMLButtonElement | null>>([]);

  const activeIndex = Math.max(
    0,
    industries.findIndex((industry) => industry.id === activeId),
  );
  const active = industries[activeIndex];

  function select(index: number) {
    const next = (index + industries.length) % industries.length;
    setActiveId(industries[next].id);
    tabs.current[next]?.focus();
  }

  /** Roving tabindex: one stop for the whole row, arrows move within it. */
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key in MOVES) {
      event.preventDefault();
      select(activeIndex + MOVES[event.key]);
      return;
    }

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      select(event.key === "Home" ? 0 : industries.length - 1);
    }
  }

  return (
    <section aria-label="Industries" className="border-b border-border">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
        <Reveal>
          <div className="mx-auto max-w-[680px] text-center">
            <p className="caption-3 text-brand">What changes</p>
            <h2 className="heading-2 mt-4">
              One workspace, from the first message to the report
            </h2>
            <p className="body-2 mt-6 text-muted-foreground">
              Same workspace, fitted to the enquiries your industry actually
              gets. Pick one to see the thread.
            </p>
          </div>
        </Reveal>

        <Reveal delay={0.05}>
          <div
            aria-label="Industries"
            className="mt-8 flex flex-wrap justify-center gap-2"
            onKeyDown={onKeyDown}
            role="tablist"
          >
            {industries.map((industry, index) => {
              const selected = industry.id === activeId;

              return (
                <button
                  key={industry.id}
                  ref={(node) => {
                    tabs.current[index] = node;
                  }}
                  aria-controls={PANEL_ID}
                  aria-selected={selected}
                  className={cn(
                    "title-4 cursor-pointer rounded-full border px-3 py-2 sm:px-4",
                    EASE,
                    FOCUS,
                    selected
                      ? "border-brand bg-brand-soft text-brand"
                      : "border-border bg-card text-muted-foreground hover:border-input hover:text-foreground",
                  )}
                  id={tabId(industry.id)}
                  onClick={() => setActiveId(industry.id)}
                  role="tab"
                  tabIndex={selected ? 0 : -1}
                  type="button"
                >
                  {industry.label}
                </button>
              );
            })}
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <div
            aria-labelledby={tabId(active.id)}
            className="mt-6"
            id={PANEL_ID}
            role="tabpanel"
          >
            <div
              key={active.id}
              className={cn(
                "grid items-center gap-8 overflow-hidden rounded-3xl border border-border bg-secondary p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.92fr)] lg:gap-12 lg:p-10",
                FOCUS,
              )}
              tabIndex={0}
            >
              <div>
                <h3 className="heading-3 text-balance">{active.headline}</h3>
                <p className="body-3 mt-4 text-muted-foreground">
                  {active.description}
                </p>

                <ul className="mt-6 space-y-3">
                  {active.points.map((point) => (
                    <li key={point} className="flex items-start gap-3">
                      <CheckCircle
                        aria-hidden="true"
                        className="mt-0.5 size-5 shrink-0 text-brand"
                        weight="fill"
                      />
                      <span className="body-5">{point}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Aspect box taken from the widest file, so the card keeps one
                  height across all five illustrations. The negative bottom
                  margin drops the picture onto the card's bottom edge: every
                  file is cropped flat at the waist, and a crop that meets the
                  edge reads as deliberate where one floating mid-card reads as
                  a mistake. */}
              <div className="aspect-[1024/796] w-full self-end -mb-6 sm:-mb-8 lg:-mb-10">
                <Image
                  alt={active.image.alt}
                  className="h-full w-full object-contain"
                  height={active.image.height}
                  loading="lazy"
                  sizes="(min-width: 1024px) 46vw, 92vw"
                  src={active.image.src}
                  /* White cut-out background; multiply drops it into the card
                     tint. Inline because this build's Tailwind does not emit
                     the `mix-blend-multiply` utility. */
                  style={{ mixBlendMode: "multiply" }}
                  width={active.image.width}
                />
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
