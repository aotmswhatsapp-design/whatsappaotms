import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The one button used across the page. Padding is the 8px by 12px the system
 * asks for, and every state is present: hover lift, pressed offset, focus ring.
 */
const BASE =
  "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 transition-[background-color,box-shadow,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 active:translate-y-px focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none";

const SIZES = { md: "button-md", sm: "button-sm" } as const;

const VARIANTS = {
  /** The accent fill. Lime on the dark field, teal on a paper band: the role
      is supplied by whichever scope the button sits in. */
  brand:
    "bg-brand text-brand-foreground hover:bg-brand/90 focus-visible:ring-brand",
  outline:
    "border border-border bg-background text-foreground hover:border-brand/40 hover:text-brand focus-visible:ring-brand",
  /** For the accent closing slab, where an accent fill would vanish into its
      own background: the action has to be the field colour instead. */
  inverse:
    "bg-background text-foreground hover:bg-background/90 focus-visible:ring-background",
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
