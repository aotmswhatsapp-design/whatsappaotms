"use client";

import { useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { site } from "@/config/site";
import type { SessionUser } from "@/lib/auth/types";
import { SidebarNav } from "./sidebar-nav";
import { WorkspaceTopBar } from "./top-bar";

/**
 * Signed-in chrome: fixed sidebar from `lg` up, top bar with search /
 * notifications / avatar, and the sidebar sliding over as a sheet below that.
 *
 * The marketing navbar is deliberately not part of this shell — the workspace
 * owns its own navigation, and "Back to website" in the sidebar footer keeps
 * the public site reachable.
 */
export function WorkspaceShell({
  user,
  children,
}: {
  user: SessionUser | null;
  children: ReactNode;
}) {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="min-h-dvh bg-background lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="hidden border-r border-border bg-background lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col">
        <SidebarBrand />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <SidebarNav />
        </div>
        <SidebarFooter />
      </aside>

      <div className="flex min-w-0 flex-col">
        <WorkspaceTopBar user={user} onOpenNav={() => setNavOpen(true)} />
        <main className="mx-auto w-full max-w-[86rem] flex-1 px-4 py-6 text-[15px] sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>

      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="left" className="w-[18rem] gap-0 p-0">
          <SheetTitle className="sr-only">Workspace navigation</SheetTitle>
          <SheetDescription className="sr-only">
            Jump to any workspace module.
          </SheetDescription>
          <SidebarBrand />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <SidebarNav onNavigate={() => setNavOpen(false)} />
          </div>
          <SidebarFooter />
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** logo.png is a wide navy lockup, so it sits on a white plate with a hairline.
    The plate cannot be the ink colour any more: the app sheet is light, and the
    navy wordmark on teal would read at about 1.3:1. */
function SidebarBrand() {
  return (
    <div className="flex h-16 shrink-0 items-center border-b border-border px-3.5">
      <Link
        href="/"
        aria-label={site.name ? `${site.name} — back to website` : "Back to website"}
        className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <span className="inline-flex rounded-md bg-card px-1.5 py-1 ring-1 ring-border">
          <Image
            src={site.logo.src}
            alt={site.logo.alt}
            width={site.logo.width}
            height={site.logo.height}
            className="h-7 w-auto"
          />
        </span>
      </Link>
    </div>
  );
}

function SidebarFooter() {
  return (
    <div className="shrink-0 border-t border-border p-2">
      <Link
        href="/"
        className="flex items-center justify-between rounded-lg px-2 py-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        Back to website
        <ArrowUpRight className="size-4" aria-hidden="true" />
      </Link>
    </div>
  );
}
