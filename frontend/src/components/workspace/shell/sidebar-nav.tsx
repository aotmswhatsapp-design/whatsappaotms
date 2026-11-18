"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { StatusDot, type StatusDotTone } from "@/components/ui/status-dot";
import { isNavItemActive, workspaceNav, type WorkspaceNavItem } from "@/config/workspace-nav";
import { useWhatsAppStatus } from "@/hooks/use-whatsapp-status";
import type { ConnectionStatus } from "@/lib/api/whatsapp-status";
import { cn } from "@/lib/utils";

/** The dot's colour and the words that say the same thing. */
function dotFor(
  item: WorkspaceNavItem,
  state: ConnectionStatus,
): { tone: StatusDotTone; label: string } | null {
  if (item.statusKey !== "whatsapp" || state.state === "none") return null;

  if (state.state === "live") {
    return { tone: "live", label: "WhatsApp connected and receiving events" };
  }

  if (state.state === "pending") {
    return {
      tone: "pending",
      label: "WhatsApp saved — waiting for Meta to confirm the webhook",
    };
  }

  return {
    tone: "error",
    label: `WhatsApp error: ${state.reason ?? "Meta rejected the stored credentials"}`,
  };
}

/**
 * Grouped workspace navigation. Groups collapse, the group holding the current
 * route is always open, and the active item is marked with `aria-current`.
 *
 * Open state is controlled with per-group overrides rather than `defaultOpen`,
 * because the sidebar does not remount between routes: without this, jumping to
 * a page inside a collapsed group (from the command palette, for example) would
 * leave the active link hidden.
 */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const whatsapp = useWhatsAppStatus();

  return (
    <nav aria-label="Workspace" className="px-2.5 pb-4">
      {workspaceNav.map((group) => {
        const groupActive = group.items.some((item) =>
          isNavItemActive(item.href, pathname),
        );
        const open =
          groupActive || (overrides[group.label] ?? group.defaultOpen);

        return (
          <Collapsible
            key={group.label}
            open={open}
            onOpenChange={(value) =>
              setOverrides((current) => ({ ...current, [group.label]: value }))
            }
            className="py-1"
          >
            <CollapsibleTrigger
              className={cn(
                "group/nav flex w-full items-center gap-2 rounded-lg px-2 py-2 text-xs font-semibold tracking-[0.1em] text-muted-foreground uppercase transition-colors",
                "hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40",
              )}
            >
              <group.icon className="size-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{group.label}</span>
              <ChevronRight
                className="ml-auto size-4 shrink-0 transition-transform duration-200 group-data-[state=open]/nav:rotate-90"
                aria-hidden="true"
              />
            </CollapsibleTrigger>

            <CollapsibleContent>
              <ul className="mt-1 space-y-0.5">
                {group.items.map((item) => {
                  const isActive = isNavItemActive(item.href, pathname);
                  const dot = dotFor(item, whatsapp);

                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        aria-current={isActive ? "page" : undefined}
                        className={cn(
                          "group/item flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-[15px] leading-tight transition-colors",
                          isActive
                            ? "bg-brand-soft font-medium text-brand"
                            : "text-muted-foreground hover:bg-accent hover:text-foreground",
                        )}
                      >
                        <item.icon
                          className={cn(
                            "size-[18px] shrink-0 transition-colors",
                            isActive
                              ? "text-brand"
                              : "text-muted-foreground/80 group-hover/item:text-foreground",
                          )}
                          aria-hidden="true"
                        />
                        <span className="truncate">{item.title}</span>
                        {dot ? (
                          <StatusDot
                            className="ml-auto"
                            label={dot.label}
                            tone={dot.tone}
                          />
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </nav>
  );
}
