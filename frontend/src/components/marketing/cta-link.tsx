import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The one button used across the page. Padding is the 8px by 12px the system
 * asks for, and every state is present: hover lift, pressed offset, focus ring.
 *
 * Hover motion lives on each variant rather than here. `pop` does not lift, it
 * steps into its own offset shadow, and two competing `translate` utilities on
 * one element cannot both win.
 */
const BASE =
  "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 transition-[background-color,box-shadow,translate] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none";

const SIZES = { md: "button-md", sm: "button-sm" } as const;

const LIFT = "hover:-translate-y-0.5 active:translate-y-px";

const VARIANTS = {
  /** The accent fill. Emerald on the light sections, the lighter green on the
      ink bands: the role is supplied by whichever scope the button sits in. */
  brand: cn(
    "bg-brand text-brand-foreground hover:bg-brand/90 focus-visible:ring-brand",
    LIFT,
  ),
  outline: cn(
    "border border-border bg-background text-foreground hover:border-brand/40 hover:text-brand focus-visible:ring-brand",
    LIFT,
  ),
  /** For a surface that already carries the accent: the action takes the
      section's own field colour instead of competing with the fill. */
  inverse: cn(
    "bg-background text-foreground hover:bg-background/90 focus-visible:ring-background",
    LIFT,
  ),
  /**
   * The hero's pressable treatment: a hairline, and a slab of its own fill
   * sitting 4px down and right. Hovering steps the plate into the slab, so the
   * shadow collapses instead of deepening — the button presses rather than
   * floats. The slab is `--brand` too, which keeps it correct on an ink band
   * where the accent is the lighter green.
   */
  pop: "border border-soft-black bg-brand text-brand-foreground shadow-[4px_4px_0_0_var(--brand)] hover:translate-x-1 hover:translate-y-1 hover:shadow-none focus-visible:ring-brand active:translate-x-1 active:translate-y-1 active:shadow-none",
} as const;

export function CtaLink({
  href,
  children,
  variant = "brand",
  size = "md",
  className,
}: {
  href: string;
  children: ReactNode;
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(BASE, SIZES[size], VARIANTS[variant], className)}
    >
      {children}
    </Link>
  );
}
