import Image from "next/image";
import Link from "next/link";
import { LayoutDashboard, LogOut } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOut } from "@/features/auth/actions";
import type { SessionUser } from "@/lib/auth/types";

/**
 * Two-letter fallback for accounts with no avatar (email/password sign-ups
 * never have one). Splits on the usual separators so "ops@aotms.com" gives
 * "OA" rather than "OP".
 */
function initialsOf(user: SessionUser): string {
  const source = user.name?.trim() || user.email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

/**
 * Avatar and account menu. Shared by the marketing navbar and the workspace
 * top bar so a signed-in user is identified identically everywhere.
 *
 * `tone` switches the ring/initials treatment for the workspace bar versus the
 * plain marketing navbar. `popoverTheme` names the palette for the menu itself:
 * it renders in a portal on `<body>`, so it sits outside whatever `data-theme`
 * scope the trigger inherited and cannot pick the surface up on its own.
 */
export function UserMenu({
  user,
  tone = "sheet",
  popoverTheme,
}: {
  user: SessionUser;
  tone?: "sheet" | "plain";
  popoverTheme?: "day" | "band" | "ink" | "sheet";
}) {
  const label = user.name ?? user.email;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Account menu for ${label}`}
          className={
            tone === "sheet"
              ? "group inline-flex size-9 shrink-0 items-center justify-center rounded-full ring-2 ring-card/40 outline-none transition-all duration-200 hover:-translate-y-0.5 hover:ring-card/80 focus-visible:ring-2 focus-visible:ring-card focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=open]:ring-card"
              : "group inline-flex size-9 shrink-0 items-center justify-center rounded-full ring-2 ring-border outline-none transition-all duration-200 hover:-translate-y-0.5 hover:ring-brand/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=open]:ring-brand/50"
          }
        >
          {user.avatarUrl ? (
            <Image
              src={user.avatarUrl}
              alt=""
              width={36}
              height={36}
              unoptimized
              className="size-9 rounded-full object-cover"
            />
          ) : tone === "sheet" ? (
            <span className="grid size-9 place-items-center rounded-full bg-foreground text-sm font-semibold text-card">
              {initialsOf(user)}
            </span>
          ) : (
            <span className="grid size-9 place-items-center rounded-full bg-brand text-sm font-semibold text-brand-foreground">
              {initialsOf(user)}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent data-theme={popoverTheme}>
        <DropdownMenuLabel className="py-2">
          <span className="block truncate text-sm font-semibold text-foreground">
            {user.name ?? "Signed in"}
          </span>
          <span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground">
            {user.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/workspace">
            <LayoutDashboard />
            Workspace
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <form action={signOut}>
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full">
              <LogOut />
              Sign out
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
