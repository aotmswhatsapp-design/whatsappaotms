import assert from "node:assert/strict";
import { test } from "node:test";

import {
  historyDeclined,
  historyProgress,
  historyThreads,
  mediaAssets,
  stateSyncContacts,
} from "./coexistence";

/**
 * Every case here is a shape Meta's own coexistence documentation prints.
 * These functions decide the direction, the phone number and the kind of a
 * message, and all three are silent when wrong.
 */

const at = "1739212624";

function history(entries: Record<string, unknown>[]) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "102290129340398",
        changes: [
          {
            field: "history",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "16505551234",
                phone_number_id: "pn-1",
              },
              history: entries,
            },
          },
        ],
      },
    ],
  };
}

test("a chunk yields its threads with a direction per message", () => {
  const payload = history([
    {
      metadata: { phase: 0, chunk_order: 1, progress: 40 },
      threads: [
        {
          id: "919900000000",
          context: { wa_id: "919900000000", user_id: "IN.1" },
          messages: [
            {
              from: "919900000000",
              from_user_id: "IN.1",
              id: "wamid.in",
              timestamp: at,
              type: "text",
              text: { body: "Two dosas" },
              history_context: { status: "read" },
            },
            {
              from: "919900000000",
              from_user_id: "IN.1",
              id: "wamid.media",
              timestamp: at,
              type: "media_placeholder",
              history_context: { status: "delivered" },
            },
            {
              from: "16505551234",
              to: "919900000000",
              id: "wamid.out",
              timestamp: at,
              type: "text",
              text: { body: "On my way" },
              history_context: { status: "sent" },
            },
          ],
        },
      ],
    },
  ]);

  const [thread] = historyThreads(payload);

  assert.equal(thread.phoneNumberId, "pn-1");
  assert.equal(thread.phone, "919900000000");
  assert.equal(thread.bsuid, "IN.1");
  assert.deepEqual(
    thread.messages.map((message) => [message.direction, message.kind, message.status]),
    [
      ["INBOUND", "TEXT", "READ"],
      ["INBOUND", "MEDIA_PENDING", "DELIVERED"],
      ["OUTBOUND", "TEXT", "SENT"],
    ],
  );
  assert.equal(thread.messages[0].body, "Two dosas");
  // A placeholder carries no contents and must not invent a body.
  assert.equal(thread.messages[1].body, null);
  assert.equal(thread.messages[1].mediaId, null);
});

test("a plain from equal to the business number is outbound", () => {
  const payload = history([
    {
      metadata: { phase: 0, chunk_order: 2, progress: 60 },
      threads: [
        {
          id: "919900000000",
          messages: [
            {
              from: "16505551234",
              id: "wamid.plain",
              timestamp: at,
              type: "text",
              text: { body: "Sent from the phone" },
            },
          ],
        },
      ],
    },
  ]);

  const [thread] = historyThreads(payload);

  assert.equal(thread.messages[0].direction, "OUTBOUND");
  // No `history_context`: a fallback, not a guess at a delivery receipt.
  assert.equal(thread.messages[0].status, "SENT");
});

test("a thread with neither a phone nor a user id keeps both null", () => {
  const payload = history([
    {
      metadata: { phase: 1, chunk_order: 1, progress: 100 },
      threads: [{ messages: [] }],
    },
  ]);

  const [thread] = historyThreads(payload);

  assert.equal(thread.phone, null);
  assert.equal(thread.bsuid, null);
});

test("an error status arrives with the sentence the thread shows", () => {
  const payload = history([
    {
      metadata: { phase: 0, chunk_order: 3, progress: 80 },
      threads: [
        {
          id: "919900000000",
          messages: [
            {
              from: "919900000000",
              from_user_id: "IN.1",
              id: "wamid.failed",
              timestamp: at,
              type: "text",
              text: { body: "Hello?" },
              history_context: { status: "error" },
            },
          ],
        },
      ],
    },
  ]);

  const [thread] = historyThreads(payload);

  assert.equal(thread.messages[0].status, "FAILED");
  assert.match(String(thread.messages[0].errorReason), /failed/);
});

test("progress is the highest any entry of the delivery reported", () => {
  const payload = history([
    { metadata: { phase: 0, chunk_order: 1, progress: 30 }, threads: [] },
    { metadata: { phase: 2, chunk_order: 9, progress: 100 }, threads: [] },
  ]);

  assert.deepEqual(historyProgress(payload), [
    { phoneNumberId: "pn-1", progress: 100 },
  ]);
});

test("the declined payload has no envelope and is still recognised", () => {
  // Printed verbatim in Meta's coexistence documentation.
  const payload = {
    messaging_product: "whatsapp",
    metadata: { phone_number_id: "pn-1" },
    history: [
      {
        errors: [
          {
            code: 2593109,
            title:
              "History sync is turned off by the business from the WhatsApp Business app",
            error_data: { details: "The user chose not to share their history." },
          },
        ],
      },
    ],
  };

  assert.deepEqual(historyDeclined(payload), [
    {
      phoneNumberId: "pn-1",
      sentence:
        "History sync is turned off by the business from the WhatsApp Business app",
    },
  ]);
  assert.deepEqual(historyThreads(payload), []);
});

test("a media asset names its real kind and the placeholder's wamid", () => {
  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "102290129340398",
        changes: [
          {
            field: "history",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "pn-1" },
              messages: [
                {
                  from: "919900000000",
                  id: "wamid.media",
                  timestamp: at,
                  type: "image",
                  image: {
                    id: "media-1",
                    mime_type: "image/jpeg",
                    sha256: "abc",
                    caption: "The menu",
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  assert.deepEqual(mediaAssets(payload), [
    {
      phoneNumberId: "pn-1",
      wamid: "wamid.media",
      from: "919900000000",
      kind: "IMAGE",
      mediaId: "media-1",
      mediaMime: "image/jpeg",
      mediaSha256: "abc",
      caption: "The menu",
      at: new Date(Number(at) * 1000),
    },
  ]);
});

test("a live message delivery is not mistaken for media assets", () => {
  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "102290129340398",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: "pn-1" },
              messages: [
                {
                  from: "919900000000",
                  id: "wamid.live",
                  timestamp: at,
                  type: "image",
                  image: { id: "media-2", mime_type: "image/png" },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  assert.deepEqual(mediaAssets(payload), []);
});

test("a state sync names the contact's number and its action", () => {
  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "102290129340398",
        changes: [
          {
            field: "smb_app_state_sync",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "pn-1" },
              state_sync: [
                {
                  type: "contact",
                  action: "add",
                  metadata: { timestamp: at },
                  contact: {
                    full_name: "Ravi Kumar",
                    first_name: "Ravi",
                    phone_number: "919900000000",
                    user_id: "IN.1",
                  },
                },
                {
                  type: "contact",
                  action: "remove",
                  metadata: { timestamp: at },
                  contact: { user_id: "IN.2" },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  assert.deepEqual(stateSyncContacts(payload), [
    {
      phoneNumberId: "pn-1",
      phone: "919900000000",
      bsuid: "IN.1",
      fullName: "Ravi Kumar",
      firstName: "Ravi",
      action: "add",
    },
    {
      phoneNumberId: "pn-1",
      phone: null,
      bsuid: "IN.2",
      fullName: null,
      firstName: null,
      action: "remove",
    },
  ]);
});