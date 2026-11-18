import { cn } from "@/lib/utils";

export type StatusDotTone = "live" | "pending" | "error";

const TONES: Record<StatusDotTone, { dot: string; halo: string }> = {
  live: { dot: "bg-lime", halo: "bg-lime/20" },
  pending: { dot: "bg-warning", halo: "bg-warning/20" },
  error: { dot: "bg-destructive", halo: "bg-destructive/20" },
};

/**
 * A colour that means something, plus the words that mean the same thing.
 *
 * Colour alone is not a channel: the wrapper carries `role="img"` with a label,
 * so a screen reader announces the state and a hover shows it, and the dot
 * itself stays decorative to everything else.
 */
export function StatusDot({
  tone,
  label,
  className,
}: {
  tone: StatusDotTone;
  label: string;
  className?: string;
}) {
  return (
    <span
      aria-label={label}
      className={cn("relative grid size-2.5 shrink-0 place-items-center", className)}
      role="img"
      title={label}
    >
      <span aria-hidden="true" className={cn("absolute inset-0 rounded-full", TONES[tone].halo)} />
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", TONES[tone].dot)} />
    </span>
  );
}
