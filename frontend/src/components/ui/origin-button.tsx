"use client";

import { motion } from "motion/react";
import * as React from "react";

import { cn } from "@/lib/utils";

import { useOriginFill } from "./use-origin-fill";

/**
 * Scoped token island: the button carries its own palette so it renders
 * identically wherever it is dropped. Brand tokens point at soft black, the
 * accent role on the burnt field.
 */
const componentThemeClassName =
  "[--ic-background:#d5360c] [--ic-foreground:#101010] [--ic-primary:#101010] [--ic-secondary:#d5c5ae] [--ic-surface-border:#b89f80] [--ic-border:#b89f80] [--ic-card:#e6d5bd] [--ic-card-foreground:#101010] [--ic-muted:#d5c5ae] [--ic-muted-foreground:#282018] [--ic-accent:#c4b59f] [--color-accent:var(--ic-accent)] [--color-accent-foreground:var(--ic-accent-foreground)] [--ic-accent-foreground:#101010] [--ic-input:#b89f80] [--ic-ring:rgba(16,16,16,0.38)] [--ic-destructive:#a11f05] [--ic-paper:#e6d5bd] [--ic-popover-foreground:#101010] [--ic-brand:#101010] [--ic-brand-soft:#e4c2a8] [--ic-shadow-soft:0_20px_44px_-28px_rgba(60,20,5,0.35)] [--ic-chart-1:#d5360c] [--ic-chart-2:#1d4ed8] [--ic-chart-3:#101010] [--ic-chart-4:#3f6212] [--ic-chart-5:#615a51] [--color-background:var(--ic-background)] [--color-foreground:var(--ic-foreground)] [--color-primary:var(--ic-primary)] [--color-secondary:var(--ic-secondary)] [--color-border:var(--ic-border)] [--color-card:var(--ic-card)] [--color-card-foreground:var(--ic-card-foreground)] [--color-muted:var(--ic-muted)] [--color-muted-foreground:var(--ic-muted-foreground)] [--color-accent:var(--ic-accent)] [--color-accent-foreground:var(--ic-accent-foreground)] [--color-input:var(--ic-input)] [--color-ring:var(--ic-ring)] [--color-destructive:var(--ic-destructive)] [--color-paper:var(--ic-paper)] [--color-popover-foreground:var(--ic-popover-foreground)] [--color-brand:var(--ic-brand)] [--color-brand-soft:var(--ic-brand-soft)] [--color-chart-1:var(--ic-chart-1)] [--color-chart-2:var(--ic-chart-2)] [--color-chart-3:var(--ic-chart-3)] [--color-chart-4:var(--ic-chart-4)] [--color-chart-5:var(--ic-chart-5)]";

const FILL_DURATION = 0.5;
const FILL_EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

type ButtonHTMLAttributesForMotion = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  | "onAnimationEnd"
  | "onAnimationIteration"
  | "onAnimationStart"
  | "onDrag"
  | "onDragEnd"
  | "onDragEnter"
  | "onDragExit"
  | "onDragLeave"
  | "onDragOver"
  | "onDragStart"
  | "onDrop"
>;

function assignRef<T>(ref: React.ForwardedRef<T>, value: T | null) {
  if (typeof ref === "function") {
    ref(value);
    return;
  }

  if (ref) {
    ref.current = value;
  }
}

function hasTextContent(node: React.ReactNode): boolean {
  if (typeof node === "string" || typeof node === "number") {
    return String(node).trim().length > 0;
  }

  if (Array.isArray(node)) {
    return node.some(hasTextContent);
  }

  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return hasTextContent(node.props.children);
  }

  return false;
}

type OriginButtonProps = ButtonHTMLAttributesForMotion & {
  children?: React.ReactNode;
  loading?: boolean;
};

const OriginButton = React.forwardRef<HTMLButtonElement, OriginButtonProps>(
  (
    {
      children,
      className,
      disabled = false,
      loading = false,
      type = "button",
      onBlur,
      onClick,
      onFocus,
      onKeyDown,
      onKeyUp,
      onPointerCancel,
      onPointerDown,
      onPointerEnter,
      onPointerLeave,
      onPointerUp,
      ...props
    },
    ref
  ) => {
    const isDisabled = Boolean(disabled || loading);
    const {
      active,
      coverSize,
      origin,
      setActive,
      setNode,
      moveToCenter,
      moveToPointer,
    } = useOriginFill();
    const [isPressed, setIsPressed] = React.useState(false);

    const ariaLabel = props["aria-label"];
    const ariaLabelledBy = props["aria-labelledby"];

    React.useEffect(() => {
      if (process.env.NODE_ENV === "production") {
        return;
      }

      if (
        hasTextContent(children) ||
        ariaLabel?.trim() ||
        ariaLabelledBy?.trim()
      ) {
        return;
      }

      console.warn(
        "OriginButton: provide visible label text or aria-label / aria-labelledby so the control has an accessible name."
      );
    }, [ariaLabel, ariaLabelledBy, children]);

    const showFill = !isDisabled && (active || isPressed);

    const fillTransition = { duration: FILL_DURATION, ease: FILL_EASE };

    const setMergedRef = React.useCallback(
      (node: HTMLButtonElement | null) => {
        setNode(node);
        assignRef(ref, node);
      },
      [setNode, ref]
    );

    return (
      <motion.button
        {...props}
        aria-busy={loading || undefined}
        className={cn(
          componentThemeClassName,
          "relative inline-flex h-12 cursor-pointer touch-manipulation select-none items-center justify-center overflow-hidden rounded-xl px-8 text-[15px] font-medium tracking-[-0.02em]",
          "border border-border bg-card text-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.55),0_12px_28px_-12px_rgba(60,20,5,0.35)]",
          "transition-[color,box-shadow] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "disabled:pointer-events-none disabled:opacity-50",
          showFill && "text-brand-foreground",
          className
        )}
        data-pressed={isPressed ? "true" : "false"}
        disabled={isDisabled}
        onBlur={(event) => {
          onBlur?.(event);
          setIsPressed(false);
          if (!event.defaultPrevented) {
            setActive(false);
          }
        }}
        onClick={onClick}
        onFocus={(event) => {
          onFocus?.(event);
          if (isDisabled || event.defaultPrevented) return;
          if (event.currentTarget.matches(":focus-visible")) {
            moveToCenter();
            setActive(true);
          }
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);

          if (
            event.defaultPrevented ||
            isDisabled ||
            event.repeat ||
            (event.key !== " " && event.key !== "Enter")
          ) {
            return;
          }

          if (event.key === " ") {
            event.preventDefault();
          }

          moveToCenter();
          setIsPressed(true);
          setActive(true);
        }}
        onKeyUp={(event) => {
          onKeyUp?.(event);

          if (event.key === " " || event.key === "Enter") {
            setIsPressed(false);
            if (!event.currentTarget.matches(":focus-visible")) {
              setActive(false);
            }
          }
        }}
        onPointerCancel={(event) => {
          onPointerCancel?.(event);
          setIsPressed(false);
        }}
        onPointerDown={(event) => {
          onPointerDown?.(event);

          if (event.defaultPrevented || isDisabled || event.button !== 0) {
            return;
          }

          moveToPointer(event);
          setIsPressed(true);
          setActive(true);
        }}
        onPointerEnter={(event) => {
          onPointerEnter?.(event);
          if (isDisabled || event.defaultPrevented) return;
          moveToPointer(event);
          setActive(true);
        }}
        onPointerLeave={(event) => {
          onPointerLeave?.(event);
          setActive(false);
          setIsPressed(false);
        }}
        onPointerUp={(event) => {
          onPointerUp?.(event);
          setIsPressed(false);
        }}
        ref={setMergedRef}
        type={type}
        whileTap={isDisabled ? undefined : { scale: 0.985 }}
      >
        <motion.span
          animate={{ scale: showFill && coverSize > 0 ? 1 : 0 }}
          aria-hidden
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle_at_center,#2e2e2c_0%,#1d1d1b_58%,#101010_100%)]"
          initial={false}
          style={{
            height: coverSize,
            left: origin.x,
            top: origin.y,
            width: coverSize,
          }}
          transition={fillTransition}
        />
        <span className="relative z-10 inline-flex items-center justify-center gap-2">
          {children}
        </span>
      </motion.button>
    );
  }
);
OriginButton.displayName = "OriginButton";

export { OriginButton };
export type { OriginButtonProps };
