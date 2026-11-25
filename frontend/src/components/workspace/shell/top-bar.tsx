"use client";

import { useEffect, useState } from "react";
import { Menu, Search } from "lucide-react";

import { UserMenu } from "@/components/account/user-menu";
import type { SessionUser } from "@/lib/auth/types";
import { CommandPalette } from "./command-palette";
import { NotificationsMenu } from "./notifications-menu";

/**
 * Workspace header: mobile nav trigger, search (which opens the command
 * palette), notifications and the account avatar.
 *
 * ⌘K and Ctrl-K are bound on the window rather than on the search button so the
 * shortcut works from anywhere in the workspace.
 */
export function WorkspaceTopBar({
  user,
  onOpenNav,
}: {
  user: SessionUser | null;
  onOpenNav: () => void;
}) {
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Not every keydown carries a key: on-screen keyboards, assistive tools
      // and synthesised events can dispatch one with `key` undefined, and
      // `undefined.toLowerCase()` threw before the shortcut was even examined.
      if ((event.key ?? "").toLowerCase() !== "k") return;
      if (!event.metaKey && !event.ctrlKey) return;
      event.preventDefault();
      setPaletteOpen((open) => !open);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-3 backdrop-blur sm:px-4 lg:px-6">
      <button
        type="button"
        onClick={onOpenNav}
        aria-label="Open navigation"
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 lg:hidden"
      >
        <Menu className="size-5" aria-hidden="true" />
      </button>

      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        aria-label="Search workspace"
        className="group flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-secondary/70 px-3 text-[15px] text-muted-foreground transition-colors hover:border-brand/40 hover:bg-card hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 sm:max-w-sm"
      >
        <Search className="size-[18px] shrink-0" aria-hidden="true" />
        <span className="truncate">Search workspace</span>
      </button>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <NotificationsMenu />
        <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden="true" />
        {user ? <UserMenu user={user} tone="plain" /> : null}
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </header>
  );
}
