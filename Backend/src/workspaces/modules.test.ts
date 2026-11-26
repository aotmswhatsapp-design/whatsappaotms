import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ALL_MODULES,
  MODULE_DEFAULTS,
  MODULE_KEYS,
  effectiveModules,
  isConfigurableRole,
  moduleIn,
} from "./modules";

/**
 * The seeded matrix is the promise the owner's screen makes on first open, so
 * it is asserted module by module rather than by length. If a default changes,
 * this list changes with it and the diff says exactly which role gained what.
 */
test("the defaults are the PRD's division of labour", () => {
  assert.deepEqual([...MODULE_DEFAULTS.ADMIN], [
    "inbox",
    "contacts",
    "qr-codes",
    "campaigns",
    "templates",
    "chatbot",
    "automations",
    "ai",
    "analytics",
    "team",
    "billing",
    "profile",
  ]);

  assert.deepEqual([...MODULE_DEFAULTS.MANAGER], [
    "inbox",
    "contacts",
    "campaigns",
    "analytics",
  ]);

  assert.deepEqual([...MODULE_DEFAULTS.AGENT], ["inbox"]);
});

test("only the owner may manage the WhatsApp number", () => {
  for (const role of ["ADMIN", "MANAGER", "AGENT"] as const) {
    assert.equal(
      MODULE_DEFAULTS[role].includes("whatsapp"),
      false,
      `${role} must not start with the WhatsApp module`,
    );
  }
});

test("every role lands somewhere: the inbox is never off by default", () => {
  for (const role of ["ADMIN", "MANAGER", "AGENT"] as const) {
    assert.equal(MODULE_DEFAULTS[role].includes("inbox"), true);
  }
});

test("the overview is not a module, so no role can be left without a home", () => {
  assert.equal(MODULE_KEYS.includes("overview" as never), false);
  assert.deepEqual([...ALL_MODULES], [...MODULE_KEYS]);
});

test("an owner sees the whole registry without reading a row", () => {
  assert.deepEqual(effectiveModules("OWNER", []), [...ALL_MODULES]);
  // Rows that would narrow an owner are ignored: ownership is not a toggle.
  assert.deepEqual(
    effectiveModules("OWNER", [{ module: "inbox", enabled: false }]),
    [...ALL_MODULES],
  );
});

test("no rows means the seeded defaults", () => {
  assert.deepEqual(effectiveModules("MANAGER", []), [
    "inbox",
    "contacts",
    "campaigns",
    "analytics",
  ]);
});

test("a stored row adds a module the default withheld", () => {
  const modules = effectiveModules("AGENT", [
    { module: "templates", enabled: true },
  ]);

  assert.deepEqual(modules, ["inbox", "templates"]);
});

test("a stored row removes a module the default granted", () => {
  const modules = effectiveModules("MANAGER", [
    { module: "campaigns", enabled: false },
  ]);

  assert.deepEqual(modules, ["inbox", "contacts", "analytics"]);
});

test("rows are laid over the defaults in registry order, not row order", () => {
  const modules = effectiveModules("AGENT", [
    { module: "analytics", enabled: true },
    { module: "contacts", enabled: true },
  ]);

  assert.deepEqual(modules, ["inbox", "contacts", "analytics"]);
});

test("a module this build does not know is ignored, never resurrected", () => {
  const modules = effectiveModules("AGENT", [
    { module: "retired-module", enabled: true },
    { module: "inbox", enabled: false },
  ]);

  assert.deepEqual(modules, []);
});

test("a role this build does not know starts from nothing", () => {
  assert.deepEqual(effectiveModules("BILLING", []), []);
});

test("keys are matched exactly and case-sensitively", () => {
  assert.equal(moduleIn("Inbox"), null);
  assert.equal(moduleIn("inbox"), "inbox");
  assert.equal(isConfigurableRole("manager"), false);
  assert.equal(isConfigurableRole("MANAGER"), true);
});
