import type { Metadata } from "next";

import { getNavItem } from "@/config/workspace-nav";
import { InboxView } from "@/features/inbox/components/inbox-view";

const nav = getNavItem("/workspace/inbox");

export const metadata: Metadata = { title: nav.title };

export default function InboxPage() {
  // The masthead is a title and nothing else. The description here explained a
  // screen the reader was already looking at, and every line of it came out of
  // the two panes that need the height. Heights are the viewport minus the
  // shell's chrome: top bar 4rem plus `main` padding (py-6, lg:py-8).
  return (
    <div className="flex h-[calc(100dvh-7rem)] min-h-[26rem] flex-col gap-3 lg:h-[calc(100dvh-8rem)] lg:min-h-0 lg:gap-4">
      <div className="shrink-0">
        <p className="text-[10px] leading-3 font-semibold tracking-[0.14em] text-brand uppercase">
          {nav.group}
        </p>
        <h1 className="mt-1 text-[16px] leading-5 font-semibold tracking-tight text-foreground">
          {nav.title}
        </h1>
      </div>

      <InboxView />
    </div>
  );
}
