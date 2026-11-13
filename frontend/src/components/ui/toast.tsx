"use client";

import * as React from "react";
import {
  CircleCheck,
  CircleMinus,
  CircleX,
  Info,
  TriangleExclamationPoint,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";

export type ToastTone = "success" | "error" | "info";
export type CheckState = "ok" | "failed" | "skipped";

export interface ToastCheck {
  label: string;
  state: CheckState;
  detail?: string;
}

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** Per-check verdict, rendered under the description. */
  checks?: ToastCheck[];
  /** Milliseconds; 0 keeps the toast until it is dismissed. */
  duration?: number;
}

interface ToastRecord extends ToastOptions {
  id: string;
}

interface ToastApi {
  push: (options: ToastOptions) => string;
  dismiss: (id: string) => void;
}

const ToastContext = React.createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = React.useContext(ToastContext);

  if (!api) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }

  return api;
}

const TONES: Record<
  ToastTone,
  { icon: typeof Info; iconClass: string; barClass: string }
> = {
  success: {
    icon: CircleCheck,
    iconClass: "text-lime",
    barClass: "bg-lime",
  },
  error: {
    icon: TriangleExclamationPoint,
    iconClass: "text-destructive",
    barClass: "bg-destructive",
  },
  info: {
    icon: Info,
    iconClass: "text-blue",
    barClass: "bg-blue",
  },
};

const CHECK_ICONS: Record<CheckState, { icon: typeof Info; className: string }> = {
  ok: { icon: CircleCheck, className: "text-lime" },
  failed: { icon: CircleX, className: "text-destructive" },
  skipped: { icon: CircleMinus, className: "text-muted-foreground" },
};

/**
 * One shared stack for the whole workspace. A toast carries the verdict of an
 * operation that ran somewhere else (a network round trip), so it stays until
 * read: errors longer, and anything with a check list long enough to scan
 * either way.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastRecord[]>([]);
  const timers = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = React.useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = React.useCallback(
    (options: ToastOptions) => {
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      // Three at a time: a fourth verdict means the older ones are stale.
      setToasts((current) => [...current.slice(-2), { ...options, id }]);

      const duration =
        options.duration ?? (options.tone === "error" ? 12_000 : 8_000);

      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }

      return id;
    },
    [dismiss],
  );

  // Timers outlive the tree if the shell unmounts mid-countdown.
  React.useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const api = React.useMemo<ToastApi>(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-3 bottom-3 z-100 flex flex-col items-stretch gap-2 sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-[23rem]"
      >
        {toasts.map((toast) => (
          <ToastCard
            key={toast.id}
            onDismiss={() => dismiss(toast.id)}
            toast={toast}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: ToastRecord;
  onDismiss: () => void;
}) {
  const tone = TONES[toast.tone ?? "info"];
  const Icon = tone.icon;

  return (
    <div
      className={cn(
        "pointer-events-auto relative max-h-[70vh] overflow-y-auto rounded-xl border border-border bg-card p-3.5 shadow-lg shadow-black/10",
        "animate-in fade-in slide-in-from-bottom-2 duration-200",
      )}
      role={toast.tone === "error" ? "alert" : "status"}
    >
      <span
        aria-hidden="true"
        className={cn("absolute inset-x-0 top-0 h-0.5", tone.barClass)}
      />

      <div className="flex items-start gap-2.5">
        <Icon
          aria-hidden="true"
          className={cn("mt-0.5 size-4 shrink-0", tone.iconClass)}
        />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] leading-snug font-semibold text-foreground">
            {toast.title}
          </p>
          {toast.description ? (
            <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
              {toast.description}
            </p>
          ) : null}
        </div>
        <button
          aria-label="Dismiss notification"
          className="-mr-1 -mt-1 grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-ring/40 focus-visible:ring-[3px] focus-visible:outline-none"
          onClick={onDismiss}
          type="button"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {toast.checks?.length ? (
        <ul className="mt-2.5 space-y-1.5 border-t border-border/70 pt-2.5">
          {toast.checks.map((check) => {
            const marker = CHECK_ICONS[check.state];
            const MarkerIcon = marker.icon;

            return (
              <li key={check.label} className="flex items-start gap-2">
                <MarkerIcon
                  aria-hidden="true"
                  className={cn("mt-0.5 size-3.5 shrink-0", marker.className)}
                />
                <span className="min-w-0">
                  <span className="block text-[11.5px] font-medium text-foreground">
                    {check.label}
                  </span>
                  {check.detail ? (
                    <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                      {check.detail}
                    </span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
