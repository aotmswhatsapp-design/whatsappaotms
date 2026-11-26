import assert from "node:assert/strict";
import { test } from "node:test";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import type { WorkspaceRole } from "@prisma/client";

import { WorkspaceRolesGuard } from "./workspace-roles.guard";
import type { WorkspacesService } from "./workspaces.service";

/**
 * The guard reads two metadata keys and one membership. Both are faked here so
 * the refusal itself is what is under test: which role is turned away, which
 * module is refused, and that an owner is never refused a module.
 */
function context(claims: unknown): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => ({ auth: claims }),
    }),
  } as unknown as ExecutionContext;
}

function reflector(required?: WorkspaceRole[], module?: string): Reflector {
  return {
    getAllAndOverride: (key: string) => {
      if (key === "workspace-roles") return required;
      if (key === "workspace-module") return module;
      return undefined;
    },
  } as unknown as Reflector;
}

function workspaces(options: {
  role: WorkspaceRole;
  modules?: string[];
}): WorkspacesService {
  return {
    membershipFor: async () => ({
      workspaceId: "ws-1",
      role: options.role,
    }),
    primaryFor: async () => ({
      userId: "user-1",
      workspaceId: "ws-1",
      role: options.role,
    }),
    modulesFor: async () => options.modules ?? [],
  } as unknown as WorkspacesService;
}

const claims = { id: "user-1", email: "one@test.dev" };

test("an ungated route costs nothing and passes", async () => {
  const guard = new WorkspaceRolesGuard(
    reflector(),
    workspaces({ role: "AGENT" }),
  );

  assert.equal(await guard.canActivate(context(claims)), true);
});

test("a missing session is a 401, not a 403", async () => {
  const guard = new WorkspaceRolesGuard(
    reflector(["OWNER"]),
    workspaces({ role: "OWNER" }),
  );

  await assert.rejects(
    () => guard.canActivate(context(undefined)),
    (error: unknown) => error instanceof UnauthorizedException,
  );
});

test("a role below the minimum is refused with ROLE_REQUIRED", async () => {
  const guard = new WorkspaceRolesGuard(
    reflector(["ADMIN"]),
    workspaces({ role: "MANAGER" }),
  );

  await assert.rejects(
    () => guard.canActivate(context(claims)),
    (error: unknown) => {
      assert.ok(error instanceof ForbiddenException);
      assert.equal((error.getResponse() as { code: string }).code, "ROLE_REQUIRED");
      return true;
    },
  );
});

test("a role at the minimum passes", async () => {
  const guard = new WorkspaceRolesGuard(
    reflector(["MANAGER"]),
    workspaces({ role: "MANAGER" }),
  );

  assert.equal(await guard.canActivate(context(claims)), true);
});

test("a ladder of ranks accepts the highest one asked for", async () => {
  const guard = new WorkspaceRolesGuard(
    reflector(["OWNER", "ADMIN"]),
    workspaces({ role: "ADMIN" }),
  );

  assert.equal(await guard.canActivate(context(claims)), true);
});

test("the owner-only refusal names the owner", async () => {
  const guard = new WorkspaceRolesGuard(
    reflector(["OWNER"]),
    workspaces({ role: "ADMIN" }),
  );

  await assert.rejects(
    () => guard.canActivate(context(claims)),
    (error: unknown) => {
      assert.ok(error instanceof ForbiddenException);
      assert.match(
        (error.getResponse() as { message: string }).message,
        /owner/i,
      );
      return true;
    },
  );
});

test("a module the owner switched off is refused with MODULE_DISABLED", async () => {
  const guard = new WorkspaceRolesGuard(
    reflector(undefined, "campaigns"),
    workspaces({ role: "AGENT", modules: ["inbox"] }),
  );

  await assert.rejects(
    () => guard.canActivate(context(claims)),
    (error: unknown) => {
      assert.ok(error instanceof ForbiddenException);
      const response = error.getResponse() as { code: string; message: string };
      assert.equal(response.code, "MODULE_DISABLED");
      assert.match(response.message, /Campaigns/);
      return true;
    },
  );
});

test("a module the owner switched on passes", async () => {
  const guard = new WorkspaceRolesGuard(
    reflector(undefined, "campaigns"),
    workspaces({ role: "AGENT", modules: ["inbox", "campaigns"] }),
  );

  assert.equal(await guard.canActivate(context(claims)), true);
});

test("the owner is never refused a module, even with none stored", async () => {
  const guard = new WorkspaceRolesGuard(
    reflector(undefined, "whatsapp"),
    workspaces({ role: "OWNER", modules: [] }),
  );

  assert.equal(await guard.canActivate(context(claims)), true);
});

test("role and module are both enforced when both are declared", async () => {
  const guard = new WorkspaceRolesGuard(
    reflector(["MANAGER"], "campaigns"),
    workspaces({ role: "AGENT", modules: ["campaigns"] }),
  );

  await assert.rejects(
    () => guard.canActivate(context(claims)),
    (error: unknown) => {
      assert.ok(error instanceof ForbiddenException);
      assert.equal((error.getResponse() as { code: string }).code, "ROLE_REQUIRED");
      return true;
    },
  );
});
