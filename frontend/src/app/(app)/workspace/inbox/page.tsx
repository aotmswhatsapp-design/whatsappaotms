import type { Metadata } from "next";
import { Suspense } from "react";

import { getNavItem } from "@/config/workspace-nav";
import { InboxView } from "@/features/inbox/components/inbox-view";

const nav = getNavItem("/workspace/inbox");

export const metadata: Metadata = { title: nav.title };

type Search = { conversation?: string | string[] };

/**
 * No eyebrow, no h1. The inbox is the page: a heading above it only pushed
 * the panes down and repeated the word the sidebar was already showing.
 *
 * The wrapper bleeds out of the shell's `main` padding (the negative margins
 * are that padding, negated) and claims the height under the 64px top bar.
 * Padding cancelled plus an exact height is what makes the document one
 * viewport tall, so the panes never scroll the page — the card is the
 * window rather than a widget on it.
 *
 * `?conversation=` is how the agents screen links a run to the thread it
 * answered. `searchParams` is a promise, so reading it needs a Suspense
 * boundary above — the same shape `/verify-email` uses to prefill an address
 * without losing its static shell.
 */
export default function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  return (
    <div className="-mx-4 -my-6 h-[calc(100dvh-4rem)] sm:-mx-6 lg:-mx-8 lg:-my-8">
      <Suspense fallback={<div className="h-full" />}>
        <LinkedThread searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function LinkedThread({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const { conversation } = await searchParams;
  const initialConversationId = Array.isArray(conversation)
    ? conversation[0]
    : conversation;

  return <InboxView initialConversationId={initialConversationId} />;
}
