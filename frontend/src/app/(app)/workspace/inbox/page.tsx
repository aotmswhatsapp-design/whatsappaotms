import type { Metadata } from "next";

import { PageHeader } from "@/components/workspace/page-header";
import { getNavItem } from "@/config/workspace-nav";
import { InboxView } from "@/features/inbox/components/inbox-view";

const nav = getNavItem("/workspace/inbox");

export const metadata: Metadata = { title: nav.title };

export default function InboxPage() {
  // A column, not a stack: the inbox fills whatever height the shell leaves
  // under its heading instead of floating in a fixed-height card. The heights
  // are the viewport minus the shell's own chrome — the top bar (4rem) and
  // `main`'s padding (`py-6`, `lg:py-8`) — because the grid row is otherwise
  // sized by this content, which would let a short window push the panel down.
  return (
    <div className="flex h-[calc(100dvh-7rem)] min-h-[26rem] flex-col gap-6 lg:h-[calc(100dvh-8rem)] lg:min-h-0">
      <PageHeader
        description="Every WhatsApp conversation in one queue: read the thread, reply inside the 24-hour window, attach files, assign an agent and leave notes your customer never sees."
        eyebrow={nav.group}
        title={nav.title}
      />

      <InboxView />
    </div>
  );
}
