import assert from "node:assert/strict";
import { test } from "node:test";

import type { AuthClaims } from "../auth/auth.types";
import type { PrismaService } from "../prisma/prisma.service";
import type { WorkspacesService } from "../workspaces/workspaces.service";
import { CrmSettingsService } from "./crm.settings";

const claims = { id: "user-1", email: "one@test.dev" } as AuthClaims;

/**
 * A roster of designations and the row the owner saved. `read()` asks for both
 * twice (once inside `plan`, once for the choices), so the stub answers from
 * the same fixture every time.
 */
function service(roster: (string | null)[], stored: string | null): CrmSettingsService {
  const prisma = {
    crmSettings: {
      findUnique: async () => ({
        leadDesignation: stored,
        autoAssign: true,
        autoTask: true,
        taskDueHours: 24,
      }),
    },
    workspaceMember: {
      groupBy: async () => roster.map((designation) => ({ designation })),
    },
  } as unknown as PrismaService;

  const workspaces = {
    primaryFor: async () => ({ userId: "user-1", workspaceId: "ws-1", role: "OWNER" }),
  } as unknown as WorkspacesService;

  return new CrmSettingsService(prisma, workspaces);
}

test("an explicit choice is still an explicit choice when the roster holds one title", async () => {
  const settings = await service(["Sales"], "Sales").read(claims);

  // Reporting this as "not chosen" would reset the owner's select on reload.
  assert.equal(settings.leadDesignation, "Sales");
  assert.equal(settings.effectiveDesignation, "Sales");
  assert.deepEqual(settings.designations, ["Sales"]);
});

test("the only designation is used, but is not reported as chosen", async () => {
  const settings = await service(["Sales"], null).read(claims);

  assert.equal(settings.leadDesignation, null);
  assert.equal(settings.effectiveDesignation, "Sales");
});

test("two titles and no stored choice mean no rotation", async () => {
  const settings = await service(["Sales", "Support"], null).read(claims);

  assert.equal(settings.leadDesignation, null);
  assert.equal(settings.effectiveDesignation, null);
  assert.deepEqual(settings.designations, ["Sales", "Support"]);
});

test("blank titles are not choices", async () => {
  const settings = await service(["  ", null], null).read(claims);

  assert.deepEqual(settings.designations, []);
  assert.equal(settings.effectiveDesignation, null);
});
