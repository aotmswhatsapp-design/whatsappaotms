"use client";

import * as React from "react";

import { ToastProvider } from "@/components/ui/toast";
import type { InboxMessage, ThreadPayload } from "@/features/inbox/api";
import { MessageThread } from "@/features/inbox/components/message-thread";

/** Throwaway harness: the real thread against fixture data. Delete after use. */

/** Fixed stamps — `Date.now()` in a client component breaks hydration. */
function at(minutesAgo: number): string {
  return new Date(Date.parse("2026-11-22T05:42:00.000Z") - minutesAgo * 60_000).toISOString();
}

function message(
  overrides: Partial<InboxMessage> &
    Pick<InboxMessage, "id" | "direction" | "kind" | "createdAt">,
): InboxMessage {
  return {
    status: "READ",
    body: null,
    sentAt: null,
    deliveredAt: null,
    readAt: null,
    errorReason: null,
    template: null,
    media: null,
    quotedMessageId: null,
    payload: null,
    ...overrides,
  };
}

export default function ThreadCheckPage() {
  const thread = React.useMemo<ThreadPayload>(() => {
    const messages: InboxMessage[] = [
      message({
        id: "m1",
        direction: "INBOUND",
        kind: "TEXT",
        createdAt: at(18),
        body: "Hi, is the blue kurta still available in size M?",
      }),
      message({
        id: "m2",
        direction: "OUTBOUND",
        kind: "TEXT",
        createdAt: at(16),
        body: "Yes — two are left. Shall I hold one for you?",
        quotedMessageId: "m1",
      }),
      message({
        id: "r1",
        direction: "INBOUND",
        kind: "REACTION",
        createdAt: at(15),
        body: "👍",
        quotedMessageId: "m2",
      }),
      message({
        id: "r2",
        direction: "OUTBOUND",
        kind: "REACTION",
        createdAt: at(14),
        body: "🙏",
        quotedMessageId: "m2",
      }),
      message({
        id: "m3",
        direction: "INBOUND",
        kind: "LOCATION",
        createdAt: at(10),
        body: "Bandra shop",
        payload: {
          kind: "location",
          latitude: 19.07609,
          longitude: 72.877426,
          name: "Bandra shop",
          address: "Linking Road, Bandra West, Mumbai 400050",
        },
      }),
      message({
        id: "m4",
        direction: "OUTBOUND",
        kind: "CONTACTS",
        createdAt: at(8),
        body: "Priya Nair",
        payload: {
          kind: "contacts",
          contacts: [
            {
              name: "Priya Nair",
              phones: ["+91 98765 43210"],
              emails: ["priya@example.com"],
              organization: "AOTMS",
            },
          ],
        },
      }),
      message({
        id: "m5",
        direction: "OUTBOUND",
        kind: "TEXT",
        createdAt: at(6),
        body: "Here is the pin, and my colleague's card is above it.",
        quotedMessageId: "m3",
      }),
    ];

    return {
      conversation: {
        id: "11111111-1111-4111-8111-111111111111",
        status: "OPEN",
        contact: {
          id: "22222222-2222-4222-8222-222222222222",
          waId: "919000012345",
          name: "Ritika Sharma",
          phone: "+91 90000 12345",
        },
        assignedTo: null,
        lastMessageAt: at(6),
        lastMessagePreview: "Here is the pin, and my colleague's card is above it.",
        lastInboundAt: at(10),
        unreadCount: 0,
        windowOpen: true,
      },
      messages,
      notes: [],
    };
  }, []);

  return (
    <ToastProvider>
      <div
        data-theme="inbox"
        className="mx-auto flex h-[100dvh] max-w-[1180px] flex-col overflow-hidden bg-card"
      >
        <MessageThread
          agents={[]}
          loading={false}
          thread={thread}
          onBack={() => undefined}
          onChanged={() => undefined}
          onDeleted={() => undefined}
          onMessage={() => undefined}
          onNote={() => undefined}
          onReaction={() => undefined}
        />
      </div>
    </ToastProvider>
  );
}
