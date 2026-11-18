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
          "bg-primary text-primary-foreground shadow-xs hover:-translate-y-0.5 hover:bg-primary/90 hover:shadow-md disabled:bg-secondary disabled:text-muted-foreground disabled:shadow-none",
        brand:
          "bg-brand text-brand-foreground shadow-xs hover:-translate-y-0.5 hover:bg-brand/90 hover:shadow-lg hover:shadow-brand/25 disabled:bg-secondary disabled:text-muted-foreground disabled:shadow-none",
        /**
         * Inverted pill: teal plate, white label. The highest-contrast action
         * available on the app's light sheet.
         */
        light:
          "bg-foreground text-card shadow-xs hover:-translate-y-0.5 hover:bg-foreground/90 hover:shadow-lg hover:shadow-black/20",
        /** Outline control that stays legible on the sheet. */
        inverse:
          "border border-foreground/30 text-foreground hover:-translate-y-0.5 hover:border-foreground/60 hover:bg-foreground/10",
        /** Borderless control for the sheet. */
        "inverse-ghost":
          "text-foreground/85 hover:bg-foreground/10 hover:text-foreground",
        destructive:
          "bg-destructive text-card shadow-xs hover:-translate-y-0.5 hover:bg-destructive/90 hover:shadow-md focus-visible:ring-destructive/20",
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
