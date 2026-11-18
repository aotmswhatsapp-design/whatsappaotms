"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";

import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/**
 * A value that exists only to be pasted somewhere else.
 *
 * The whole point is that copy never fails silently: the button says "Copied"
 * for long enough to register, and a refused clipboard (an insecure origin, or
 * a browser policy) explains itself instead of doing nothing.
 */
export function CopyField({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | null;
  hint?: string;
}) {
  const toast = useToast();
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1_800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy() {
    if (!value) return;

    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      toast.push({
        tone: "error",
        title: "Could not copy",
        description: "Select the value and copy it by hand.",
        duration: 6_000,
      });
    }
  }

  return (
    <div>
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-stretch gap-2">
        <code
          className={cn(
            "min-w-0 flex-1 truncate rounded-lg border border-border bg-secondary px-3 py-2.5 font-mono text-[12.5px] text-foreground",
            !value && "text-muted-foreground italic",
          )}
        >
          {value ?? "Not configured"}
        </code>
        <button
          aria-label={`Copy ${label}`}
          className={cn(
            "grid w-11 shrink-0 cursor-pointer place-items-center rounded-lg border border-border bg-card text-foreground transition-colors",
            "hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50",
          )}
          disabled={!value}
          onClick={copy}
          type="button"
        >
          {copied ? (
            <Check className="size-4 text-lime" aria-hidden="true" />
          ) : (
            <Copy className="size-4" aria-hidden="true" />
          )}
        </button>
      </div>
      {copied ? (
        <p aria-live="polite" className="mt-1 text-[11px] text-lime">
          Copied to the clipboard.
        </p>
      ) : hint ? (
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
