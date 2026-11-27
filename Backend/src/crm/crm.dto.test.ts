// `@Type` reads the reflected property type when the class is defined, so the
// polyfill the app loads in `main.ts` has to be here first.
import "reflect-metadata";

import assert from "node:assert/strict";
import { test } from "node:test";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { CrmSettingsDto, UpdateTaskDto } from "./crm.dto";

/**
 * The routes rely on the global pipe, so the DTOs are tested the way the pipe
 * uses them: transform, then validate. Anything listed here is a 400 before a
 * service can hand a null to a column that cannot hold one.
 */
async function invalid(cls: new () => object, input: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(cls, input);
  return (await validate(dto)).map((error) => error.property);
}

test("a null switch is refused, because null is not a boolean to store", async () => {
  assert.deepEqual(await invalid(CrmSettingsDto, { autoAssign: null }), ["autoAssign"]);
  assert.deepEqual(await invalid(CrmSettingsDto, { autoTask: null }), ["autoTask"]);
  assert.deepEqual(await invalid(CrmSettingsDto, { taskDueHours: null }), ["taskDueHours"]);
});

test("an empty body is valid and changes nothing", async () => {
  assert.deepEqual(await invalid(CrmSettingsDto, {}), []);
});

test("due hours stay inside a sane range", async () => {
  assert.deepEqual(await invalid(CrmSettingsDto, { taskDueHours: 0 }), ["taskDueHours"]);
  assert.deepEqual(await invalid(CrmSettingsDto, { taskDueHours: 721 }), ["taskDueHours"]);
  assert.deepEqual(await invalid(CrmSettingsDto, { taskDueHours: 720 }), []);
});

test("a null status is refused while a null deadline clears one", async () => {
  assert.deepEqual(await invalid(UpdateTaskDto, { status: null }), ["status"]);
  assert.deepEqual(await invalid(UpdateTaskDto, { dueAt: null }), []);
});

test("a designation's length is capped, and null means not chosen", async () => {
  assert.deepEqual(await invalid(CrmSettingsDto, { leadDesignation: "x".repeat(41) }), [
    "leadDesignation",
  ]);
  assert.deepEqual(await invalid(CrmSettingsDto, { leadDesignation: null }), []);
});
