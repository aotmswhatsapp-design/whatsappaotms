import type { Metadata } from "next";

import { getNavItem } from "@/config/workspace-nav";
import { InboxView } from "@/features/inbox/components/inbox-view";

const nav = getNavItem("/workspace/inbox");

export const metadata: Metadata = { title: nav.title };

export default function InboxPage() {
  // The masthead is a title and nothing else. The description here explained a
  // screen the reader was already looking at, and every line of it came out of
  // the two panes.
  //
  // No viewport height on this container. Pinning it to `100dvh` minus the
  // shell's chrome made the page the exact size of the window, so it could
  // never scroll and a short laptop lost the bottom of the thread. The card
  // below now names its own height and the page scrolls like every other
  // screen.
  return (
    <div className="flex flex-col gap-3 lg:gap-4">
      <div>
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
