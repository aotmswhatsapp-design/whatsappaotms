import Link from "next/link";
import { ArrowLeft, CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";

interface SectionPlaceholderProps {
  eyebrow: string;
  title: string;
  description: string;
  items: string[];
}

export function SectionPlaceholder({
  eyebrow,
  title,
  description,
  items,
}: SectionPlaceholderProps) {
  return (
    <section className="mx-auto w-full max-w-3xl px-5 py-20 lg:px-8">
      <p className="text-xs font-semibold tracking-[0.14em] text-brand uppercase">
        {eyebrow}
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
        {title}
      </h1>
      <p className="mt-4 text-base leading-relaxed text-muted-foreground">
        {description}
      </p>

      <ul className="mt-8 grid gap-3">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2 text-sm">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-lime" />
            {item}
          </li>
        ))}
      </ul>

      <div className="mt-10 rounded-xl border border-dashed border-border bg-muted/60 p-5 text-sm text-muted-foreground">
        This page is scaffolding. Real content ships with Phase 1 — pricing,
        checkout, and account activation.
      </div>

      <Button asChild variant="outline" className="mt-8">
        <Link href="/">
          <ArrowLeft className="size-4" />
          Back to home
        </Link>
      </Button>
    </section>
  );
}
