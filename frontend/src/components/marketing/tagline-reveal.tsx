"use client";

import * as React from "react";
import { useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";

const TAGLINE =
  "Nobody should have to learn Meta's business tooling just to send a WhatsApp message.";
const WORDS = TAGLINE.split(" ");

/**
 * Tagline reveal. Each word starts at 30% opacity and lifts to full as it
 * crosses the trigger line, in reading order, so the sentence assembles itself
 * instead of fading in as a block.
 *
 * One IntersectionObserver watches every word with a bottom root margin of 45%,
 * which makes the trigger line sit just above the reader's eye line. Readers
 * who ask for reduced motion get the finished sentence immediately.
 */
export function TaglineReveal() {
  const reduceMotion = useReducedMotion();
  const [lit, setLit] = React.useState<Set<number>>(new Set());
  const headingRef = React.useRef<HTMLHeadingElement>(null);

  React.useEffect(() => {
    const node = headingRef.current;
    if (!node || reduceMotion) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const arriving = entries.filter((entry) => entry.isIntersecting);
        if (arriving.length === 0) return;

        setLit((current) => {
          const next = new Set(current);
          for (const entry of arriving) {
            next.add(Number((entry.target as HTMLElement).dataset.word));
          }
          return next;
        });
      },
      { rootMargin: "0px 0px -45% 0px" },
    );

    for (const word of node.querySelectorAll("[data-word]")) {
      observer.observe(word);
    }

    return () => observer.disconnect();
  }, [reduceMotion]);

  return (
    <section
      className="border-b border-border bg-background text-foreground"
      data-theme="paper"
    >
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
        {/* A paper band: teal ink on pearl, and the rule is a quiet tint of that
            ink rather than a colour of its own. */}
        <div className="border-l-2 border-foreground/25 pl-6 lg:pl-12">
          <p className="caption-3 text-muted-foreground">Why we built this</p>
          <h2
            ref={headingRef}
            className="heading-2 mt-4 max-w-[680px] text-foreground"
          >
            {WORDS.map((word, index) => (
              <span
                key={`${word}-${index}`}
                data-word={index}
                className={cn(
                  "transition-opacity duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
                  lit.has(index) || reduceMotion ? "opacity-100" : "opacity-30",
                )}
              >
                {word}
                {index < WORDS.length - 1 ? " " : ""}
              </span>
            ))}
          </h2>
        </div>
      </div>
    </section>
  );
}
