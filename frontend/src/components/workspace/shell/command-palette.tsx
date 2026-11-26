"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Search } from "lucide-react";

import { useAccess } from "@/components/workspace/access-provider";
import { workspaceNavItems, navItemsForModules } from "@/config/workspace-nav";
import { cn } from "@/lib/utils";

/**
 * ⌘K / Ctrl-K destination switcher. Backed by the same nav config as the
 * sidebar, so anything reachable by mouse is reachable by keyboard search —
 * and, like the sidebar, only the modules this role may open.
 *
 * The query/cursor state lives in `PaletteBody`, which Radix unmounts on close
 * — that is what resets the palette between openings, with no effect needed.
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px] data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed top-[12vh] left-1/2 z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 outline-none data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          <DialogPrimitive.Title className="sr-only">
            Search workspace
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Type to filter the workspace modules, then press Enter to open the
            highlighted one.
          </DialogPrimitive.Description>
          <PaletteBody onDone={() => onOpenChange(false)} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function PaletteBody({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const { modules } = useAccess();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);

  // Only what the role may open: the palette is a shortcut, not a back door.
  const destinations = useMemo(
    () => (modules === null ? workspaceNavItems : navItemsForModules(modules)),
    [modules],
  );

  const results = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return destinations;
    return destinations.filter((item) =>
      `${item.title} ${item.group} ${item.description}`
        .toLowerCase()
        .includes(term),
    );
  }, [query, destinations]);

  const openItem = (href: string) => {
    onDone();
    router.push(href);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const count = results.length;
    if (count === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((current) => (current + 1) % count);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((current) => (current - 1 + count) % count);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = results[cursor];
      if (item) openItem(item.href);
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-popover shadow-2xl shadow-black/20">
      <div className="flex items-center gap-2.5 border-b border-border px-3.5">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          // The palette only exists once opened, so focusing on mount is the
          // intended behaviour rather than a page-load focus steal.
          autoFocus
          type="text"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setCursor(0);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Jump to a module…"
          aria-label="Search workspace modules"
          className="h-12 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <kbd className="hidden rounded border border-border bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-block">
          Esc
        </kbd>
      </div>

      <ul className="max-h-80 overflow-y-auto p-1.5">
        {results.length === 0 ? (
          <li className="px-3 py-8 text-center text-sm text-muted-foreground">
            No module matches &ldquo;{query}&rdquo;.
          </li>
        ) : (
          results.map((item, index) => (
            <li key={item.href}>
              <button
                type="button"
                onMouseEnter={() => setCursor(index)}
                onClick={() => openItem(item.href)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
                  index === cursor ? "bg-accent" : "hover:bg-accent/60",
                )}
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-md bg-brand-soft text-brand">
                  <item.icon className="size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {item.title}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {item.description}
                  </span>
                </span>
                <span className="shrink-0 text-[10px] font-semibold tracking-[0.1em] text-muted-foreground/70 uppercase">
                  {item.group}
                </span>
              </button>
            </li>
          ))
        )}
      </ul>

      <div className="flex items-center gap-4 border-t border-border px-3.5 py-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <kbd className="rounded border border-border bg-secondary px-1">↑</kbd>
          <kbd className="rounded border border-border bg-secondary px-1">↓</kbd>
          navigate
        </span>
        <span className="flex items-center gap-1">
          <kbd className="rounded border border-border bg-secondary px-1">↵</kbd>
          open
        </span>
      </div>
    </div>
  );
}
