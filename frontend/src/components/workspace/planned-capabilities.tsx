import { Check } from "lucide-react";

/**
 * Lists the capabilities a module will ship. Pulled straight from the PRD so
 * the workspace documents its own roadmap rather than hiding it.
 */
export function PlannedCapabilities({
  title = "What this module will do",
  items,
}: {
  title?: string;
  items: string[];
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <ul className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
            <Check className="mt-0.5 size-4 shrink-0 text-lime" aria-hidden="true" />
            <span className="leading-relaxed">{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
