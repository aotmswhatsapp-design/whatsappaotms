import assert from "node:assert/strict";
import { test } from "node:test";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { phoneDigits, UpdateMemberProfileDto } from "./dto/team.dto";

async function errorsFor(input: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(UpdateMemberProfileDto, input);
  return (await validate(dto)).flatMap((error) => Object.keys(error.constraints ?? {}));
}

test("a local number loses its punctuation", () => {
  assert.equal(phoneDigits("+91 98765-43210"), "919876543210");
});

test("an empty field clears the number", () => {
  assert.equal(phoneDigits("  "), null);
});

test("a valid number passes validation", async () => {
  const dto = plainToInstance(UpdateMemberProfileDto, { personalWhatsApp: "+91 98765 43210" });

  assert.deepEqual(await validate(dto), []);
  assert.equal(dto.personalWhatsApp, "919876543210");
});

test("seven digits and letters are refused", async () => {
  assert.equal((await errorsFor({ personalWhatsApp: "1234567" })).length, 1);
  assert.equal((await errorsFor({ personalWhatsApp: "call me" })).length, 1);
});

test("a designation longer than 40 characters is refused", async () => {
  assert.equal((await errorsFor({ designation: "x".repeat(41) })).length, 1);
});

test("an empty body clears nothing but is valid", async () => {
  assert.deepEqual(await errorsFor({}), []);
});
