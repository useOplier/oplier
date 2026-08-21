import { describe, it, expect, beforeEach } from "vitest";
import { SystemPermissionLifecycle } from "../src/lifecycle/permission-lifecycle";
import { InMemoryNexusPermissionRepository } from "../src/repository/in-memory-repository";
import { MockPermissionService } from "../src/mocks/mock-permission-service";
import { compareDecimalStrings } from "../src/lifecycle/permission-lifecycle";

/**
 * NOTE ON RUNNING THESE: this sandbox has no network access, so `vitest`/`typescript` couldn't
 * actually be installed here to execute this file (see FINDINGS.md preamble) — it's written
 * and reviewed by hand against the mock's contract, same limitation Part A flagged for its own
 * un-executed `tsc` pass. Run `pnpm --filter @oplier/permissions test` for real before trusting
 * it; flag back if anything here doesn't actually pass.
 */

const baseParams = {
  systemId: "sys_1",
  userWallet: "0xabc0000000000000000000000000000000000a",
  scopedContract: "0xQuickSwapRouter00000000000000000000001",
  scopedFunction: "exactInputSingle(address,address,uint256)",
  maxAllocation: "100.00",
};

function setup() {
  const permissionService = new MockPermissionService();
  const repository = new InMemoryNexusPermissionRepository();
  const lifecycle = new SystemPermissionLifecycle(permissionService, repository);
  return { permissionService, repository, lifecycle };
}

describe("activate", () => {
  it("creates a permission and a CREATED nexus_permissions row", async () => {
    const { lifecycle, permissionService, repository } = setup();
    const result = await lifecycle.activate(baseParams);

    expect(result.state).toBe("ACTIVE");
    expect(result.permissionRef).toBeTruthy();
    expect(permissionService.created).toHaveLength(1);
    expect(permissionService.created[0].maxAllocation).toBe("100.00");

    const current = await repository.findCurrentForSystem("sys_1");
    expect(current?.status).toBe("CREATED");
    expect(current?.sessionReference).toBe(result.permissionRef);
  });

  it("refuses to activate a System that already has a live permission", async () => {
    const { lifecycle } = setup();
    await lifecycle.activate(baseParams);
    await expect(lifecycle.activate(baseParams)).rejects.toThrow(/already has an active permission/);
  });
});

describe("pause / resume — doc 02: pause does not revoke, resume does not re-authorize", () => {
  it("pause leaves the session key untouched", async () => {
    const { lifecycle, permissionService } = setup();
    const { permissionRef } = await lifecycle.activate(baseParams);

    const paused = await lifecycle.pause("sys_1");
    expect(paused.state).toBe("PAUSED");
    expect(paused.permissionRef).toBe(permissionRef);
    expect(permissionService.revoked).toHaveLength(0); // pause must never revoke
  });

  it("resume re-validates the existing key without creating a new one", async () => {
    const { lifecycle, permissionService } = setup();
    await lifecycle.activate(baseParams);
    await lifecycle.pause("sys_1");

    const resumed = await lifecycle.resume("sys_1");
    expect(resumed.state).toBe("ACTIVE");
    expect(permissionService.created).toHaveLength(1); // still just the one from activate()
  });

  it("resume surfaces AUTHORIZATION_REQUIRED if the key went invalid while paused, without auto re-requesting", async () => {
    const { lifecycle, permissionService } = setup();
    const { permissionRef } = await lifecycle.activate(baseParams);
    permissionService.setCheckResponse(permissionRef!, { valid: false, reason: "expired" });

    const resumed = await lifecycle.resume("sys_1");
    expect(resumed.state).toBe("AUTHORIZATION_REQUIRED");
    expect(resumed.reason).toBe("expired");
    expect(permissionService.created).toHaveLength(1); // must NOT have auto-created a new one
  });
});

describe("delete — doc 02: fully revokes, System cannot continue executing", () => {
  it("revokes the current session key and marks the row REVOKED", async () => {
    const { lifecycle, permissionService, repository } = setup();
    const { permissionRef } = await lifecycle.activate(baseParams);

    const deleted = await lifecycle.delete("sys_1");
    expect(deleted.state).toBe("REVOKED");
    expect(permissionService.revoked).toEqual([permissionRef]);

    const current = await repository.findCurrentForSystem("sys_1");
    expect(current).toBeNull();
  });
});

describe("modify — doc 02: every modification revokes the old key and creates a new one", () => {
  it("revokes the old permission and creates a fresh one from the new scope", async () => {
    const { lifecycle, permissionService, repository } = setup();
    const first = await lifecycle.activate(baseParams);

    const modified = await lifecycle.modify({ ...baseParams, maxAllocation: "250.00" });

    expect(permissionService.revoked).toEqual([first.permissionRef]);
    expect(permissionService.created).toHaveLength(2);
    expect(permissionService.created[1].maxAllocation).toBe("250.00");
    expect(modified.permissionRef).not.toBe(first.permissionRef);

    const current = await repository.findCurrentForSystem("sys_1");
    expect(current?.sessionReference).toBe(modified.permissionRef);

    const history = await repository.findHistoryForSystem("sys_1");
    expect(history).toHaveLength(2);
    expect(history.find((r) => r.sessionReference === first.permissionRef)?.status).toBe("REVOKED");
  });
});

describe("checkBeforeExecution — the brief's specifically-required blocked-state case", () => {
  it("allows execution when the requested amount is within remaining allowance", async () => {
    const { lifecycle, permissionService } = setup();
    const { permissionRef } = await lifecycle.activate(baseParams);
    permissionService.setCheckResponse(permissionRef!, { valid: true, remainingAllowance: "100.00" });

    const check = await lifecycle.checkBeforeExecution("sys_1", "40.00");
    expect(check.allowed).toBe(true);
    expect(check.state).toBe("ACTIVE");
  });

  it("blocks execution when the requested amount exceeds remaining allowance, WITHOUT auto-expanding permissions", async () => {
    const { lifecycle, permissionService } = setup();
    const { permissionRef } = await lifecycle.activate(baseParams);
    permissionService.setCheckResponse(permissionRef!, { valid: true, remainingAllowance: "30.00" });

    const check = await lifecycle.checkBeforeExecution("sys_1", "50.00");

    expect(check.allowed).toBe(false);
    expect(check.state).toBe("AUTHORIZATION_REQUIRED");
    expect(check.reason).toBe("requested_amount_exceeds_remaining_allowance");
    // The critical assertion (brief: "easy case to get wrong — silently expanding
    // permissions"): checkBeforeExecution must NEVER call createPermission itself.
    expect(permissionService.created).toHaveLength(1); // only the original activate() call
  });

  it("blocks execution when the permission is invalid/expired, without auto-reauthorizing", async () => {
    const { lifecycle, permissionService } = setup();
    const { permissionRef } = await lifecycle.activate(baseParams);
    permissionService.setCheckResponse(permissionRef!, { valid: false, reason: "expired" });

    const check = await lifecycle.checkBeforeExecution("sys_1", "10.00");
    expect(check.allowed).toBe(false);
    expect(check.state).toBe("AUTHORIZATION_REQUIRED");
    expect(check.reason).toBe("expired");
    expect(permissionService.created).toHaveLength(1);
  });

  it("blocks execution when no permission exists yet", async () => {
    const { lifecycle } = setup();
    const check = await lifecycle.checkBeforeExecution("sys_never_activated", "10.00");
    expect(check.allowed).toBe(false);
    expect(check.state).toBe("AUTHORIZATION_REQUIRED");
    expect(check.reason).toBe("no_active_permission");
  });

  it("allows execution exactly at the remaining allowance boundary (not just strictly under)", async () => {
    const { lifecycle, permissionService } = setup();
    const { permissionRef } = await lifecycle.activate(baseParams);
    permissionService.setCheckResponse(permissionRef!, { valid: true, remainingAllowance: "50.00" });

    const check = await lifecycle.checkBeforeExecution("sys_1", "50.00");
    expect(check.allowed).toBe(true);
  });
});

describe("compareDecimalStrings — no float conversion for money-shaped values", () => {
  it("compares values with different decimal precision correctly", () => {
    expect(compareDecimalStrings("50.00", "50.0")).toBe(0);
    expect(compareDecimalStrings("50.1", "50.10")).toBe(0);
    expect(compareDecimalStrings("50.01", "50.001")).toBe(1);
    expect(compareDecimalStrings("9.9999", "10")).toBe(-1);
    expect(compareDecimalStrings("100", "99.999999999999999999")).toBe(1);
  });
});
