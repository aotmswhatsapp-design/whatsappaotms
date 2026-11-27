import assert from "node:assert/strict";
import { test } from "node:test";

import {
  accountEvents,
  disconnectNote,
  isDisconnect,
} from "./account-events";

/** The PARTNER_REMOVED shape Meta documents: `entry[].id` is the partner. */
const partnerRemoved = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "2949482758682047",
      time: 1739212624,
      changes: [
        {
          field: "account_update",
          value: {
            event: "PARTNER_REMOVED",
            waba_info: {
              waba_id: "102290129340398",
              owner_business_id: "2329417887457253",
            },
            disconnection_info: {
              reason: "PRIMARY_INACTIVITY",
              initiated_by: "SYSTEM",
            },
          },
        },
      ],
    },
  ],
};

test("a disconnection names the customer's account, not the partner's", () => {
  const [event] = accountEvents(partnerRemoved);

  assert.ok(event, "the delivery produced no event");
  assert.equal(event.wabaId, "102290129340398");
  assert.equal(event.event, "PARTNER_REMOVED");
  assert.equal(event.reason, "PRIMARY_INACTIVITY");
  assert.equal(event.initiatedBy, "SYSTEM");
  assert.equal(isDisconnect(event), true);
});

test("an offboard carries the account in the entry, because it has no waba_info", () => {
  const [event] = accountEvents({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "862475293675413",
        time: 1768477204,
        changes: [
          { field: "account_update", value: { event: "ACCOUNT_OFFBOARDED" } },
        ],
      },
    ],
  });

  assert.ok(event);
  assert.equal(event.wabaId, "862475293675413");
  assert.equal(isDisconnect(event), true);
  assert.match(disconnectNote(event), /WhatsApp Business app/);
});

test("a reconnect is not a disconnect", () => {
  const [event] = accountEvents({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "862475293675413",
        time: 1768477203,
        changes: [
          { field: "account_update", value: { event: "ACCOUNT_RECONNECTED" } },
        ],
      },
    ],
  });

  assert.ok(event);
  assert.equal(isDisconnect(event), false);
});

test("the sentence says who ended it, and why when Meta said why", () => {
  const [system] = accountEvents(partnerRemoved);
  assert.match(disconnectNote(system), /WhatsApp/);
  assert.match(disconnectNote(system), /14 days/);

  const [customer] = accountEvents({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "1",
        changes: [
          {
            field: "account_update",
            value: {
              event: "PARTNER_REMOVED",
              waba_info: { waba_id: "102290129340398" },
              disconnection_info: {
                reason: "ACCOUNT_DISCONNECTED",
                initiated_by: "USER",
              },
            },
          },
        ],
      },
    ],
  });

  assert.match(disconnectNote(customer), /by the business/);
});

test("an unknown reason still gives the owner something to act on", () => {
  const [event] = accountEvents({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "1",
        changes: [
          {
            field: "account_update",
            value: {
              event: "PARTNER_REMOVED",
              waba_info: { waba_id: "102290129340398" },
            },
          },
        ],
      },
    ],
  });

  assert.equal(event.reason, null);
  assert.match(disconnectNote(event), /Connect the number again/);
});

test("a delivery that is not an account update produces nothing", () => {
  assert.deepEqual(
    accountEvents({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "waba-1",
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "pn-1" },
                messages: [{ id: "wamid.1", from: "1", type: "text" }],
              },
            },
          ],
        },
      ],
    }),
    [],
  );
});
