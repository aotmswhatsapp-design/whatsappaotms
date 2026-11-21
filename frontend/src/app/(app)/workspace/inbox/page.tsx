import type { Metadata } from "next";

import { getNavItem } from "@/config/workspace-nav";
import { InboxView } from "@/features/inbox/components/inbox-view";

const nav = getNavItem("/workspace/inbox");

export const metadata: Metadata = { title: nav.title };

export default function InboxPage() {
  // No eyebrow, no h1. The inbox is the page: a heading above it only pushed
  // the panes down and repeated the word the sidebar was already showing.
  //
  // The wrapper bleeds out of the shell's `main` padding (the negative margins
  // are that padding, negated) and claims the height under the 64px top bar.
  // Padding cancelled plus an exact height is what makes the document one
  // viewport tall, so the panes never scroll the page — the card is the
  // window rather than a widget on it.
  return (
    <div className="-mx-4 -my-6 h-[calc(100dvh-4rem)] sm:-mx-6 lg:-mx-8 lg:-my-8">
      <InboxView />
    </div>
  );
}
