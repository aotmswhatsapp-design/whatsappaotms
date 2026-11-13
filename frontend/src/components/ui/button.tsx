import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium outline-none transition-all duration-200 disabled:pointer-events-none disabled:opacity-50 active:translate-y-0 active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 focus-visible:ring-ring/40 focus-visible:ring-[3px] focus-visible:border-ring",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-xs hover:-translate-y-0.5 hover:bg-primary/90 hover:shadow-md",
        brand:
          "bg-brand text-white shadow-xs hover:-translate-y-0.5 hover:bg-brand/90 hover:shadow-lg hover:shadow-brand/25",
        /**
         * White pill for the orange sheets (navbar, hero). The orange label is
         * the hero's own top colour, so it matches the sheet behind it.
         */
        light:
          "bg-white text-[#9c3a11] shadow-xs hover:-translate-y-0.5 hover:bg-[#ffedd5] hover:shadow-lg hover:shadow-black/20",
        /** Outline control that stays legible on a coloured sheet. */
        inverse:
          "border border-white/30 text-white hover:-translate-y-0.5 hover:border-white/60 hover:bg-white/10",
        /** Borderless control for a coloured sheet. */
        "inverse-ghost": "text-white/85 hover:bg-white/10 hover:text-white",
        destructive:
          "bg-destructive text-white shadow-xs hover:-translate-y-0.5 hover:bg-destructive/90 hover:shadow-md focus-visible:ring-destructive/20",
        outline:
          "border border-border bg-background shadow-xs hover:-translate-y-0.5 hover:border-brand/40 hover:bg-accent hover:text-accent-foreground hover:shadow-sm",
        secondary:
          "bg-secondary text-secondary-foreground shadow-xs hover:-translate-y-0.5 hover:bg-secondary/80 hover:shadow-sm",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-brand underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
        lg: "h-11 rounded-md px-6 text-[0.95rem] has-[>svg]:px-4",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
