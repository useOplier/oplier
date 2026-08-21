import { describe, it, expect } from "vitest";
import { toEngineAdapter } from "../src/engine-adapter";
import { InMemoryNexusPermissionRepository } from "../src/repository/in-memory-repository";
import { MockPermissionService } from "../src/mocks/mock-permission-service";
import { AMM_ROUTER_ADDRESS_XLAYER_TESTNET, AMM_ROUTER_FUNCTION_SELECTORS } from "../src/chain";

/**
 * Exercises `toEngineAdapter` against the real shapes copied from Part C's `types.ts`
 * (`EnginePermissionScope` / `EnginePermissionRef`), confirming the reconciliation described
 * in types.ts's "RECONCILED AGAINST PART C'S REAL types.ts" section actually holds together
 * end to end. Same run caveat as permission-lifecycle.test.ts — not executed in this sandbox
 * (no network to install vitest), hand-reviewed against the mock's contract.
 */

describe("toEngineAdapter", () => {
  function setup() {
    const permissionService = new MockPermissionService();
    const repository = new InMemoryNexusPermissionRepository();
    const adapter = toEngineAdapter(permissionService, repository);
    return { permissionService, repository, adapter };
  }

  it("createPermission maps the engine's real PermissionScope (no contract/function) onto the fixed router scope", async () => {
    const { permissionService, adapter } = setup();

    const ref = await adapter.createPermission({
      systemId: "sys_1",
      walletAddress: "0xUser0000000000000000000000000000000001",
      maxAllocation: "500.00",
      maxAllocationAsset: "test_usdg",
      assets: ["test_aapl", "test_usdg"],
    });

    expect(permissionService.created).toHaveLength(1);
    const call = permissionService.created[0];
    expect(call.scopedContract).toBe(AMM_ROUTER_ADDRESS_XLAYER_TESTNET); // Part K-confirmed Uniswap V2 router
    // Array, not a comma-joined string (Part I): Solidity signatures contain commas, so the old
    // joined form could not be split back apart into valid signatures.
    expect(call.scopedFunction).toEqual(AMM_ROUTER_FUNCTION_SELECTORS);
    expect(call.scopedFunction).toEqual([
      "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
    ]);
    expect(call.maxAllocation).toBe("500.00");
    expect(call.spendLimitAssetId).toBe("test_usdg");
    expect(call.expiresAt).toBeUndefined(); // no expiresAt on the real PermissionScope

    // EnginePermissionRef shape: { id, sessionReference } — id is the persisted DB row id,
    // NOT this package's own opaque permissionRef string.
    expect(ref.id).toBeTruthy();
    expect(ref.sessionReference).toBeTruthy();
    expect(ref.sessionReference).not.toBe(ref.id);
  });

  it("persists a nexus_permissions row recording assets[] for audit, even though it isn't used for scoping yet", async () => {
    const { adapter, repository } = setup();
    await adapter.createPermission({
      systemId: "sys_2",
      walletAddress: "0xUser0000000000000000000000000000000002",
      maxAllocation: "10.00",
      maxAllocationAsset: "test_usdg",
      assets: ["test_nvda", "test_usdg"],
    });

    const row = await repository.findCurrentForSystem("sys_2");
    expect(row).not.toBeNull();
    expect((row!.scope as { assets: string[] }).assets).toEqual(["test_nvda", "test_usdg"]);
  });

  it("revokePermission accepts the full EnginePermissionRef object and revokes both the vendor session and the DB row", async () => {
    const { adapter, permissionService, repository } = setup();
    const ref = await adapter.createPermission({
      systemId: "sys_3",
      walletAddress: "0xUser0000000000000000000000000000000003",
      maxAllocation: "10.00",
      maxAllocationAsset: "test_usdg",
      assets: ["test_usdg"],
    });

    await adapter.revokePermission(ref);

    expect(permissionService.revoked).toEqual([ref.sessionReference]);
    const current = await repository.findCurrentForSystem("sys_3");
    expect(current).toBeNull();
  });

  it("revokePermission with a null sessionReference skips the vendor call but still revokes the DB row", async () => {
    const { adapter, permissionService, repository } = setup();
    // Simulate a ref that never got a live vendor session (sessionReference: null) — the
    // adapter must not call service.revokePermission(null) in this case.
    const orphanRow = await repository.insert({
      systemId: "sys_4",
      sessionReference: null,
      scope: {},
    });

    await adapter.revokePermission({ id: orphanRow.id, sessionReference: null });

    expect(permissionService.revoked).toHaveLength(0);
    const current = await repository.findCurrentForSystem("sys_4");
    expect(current).toBeNull();
  });

  it("respects AMM_ROUTER_ADDRESS_OVERRIDE when set, for tests/future chains", async () => {
    const { permissionService, adapter } = setup();
    process.env.AMM_ROUTER_ADDRESS_OVERRIDE = "0xOverride000000000000000000000000000001";
    try {
      await adapter.createPermission({
        systemId: "sys_override",
        walletAddress: "0xUser0000000000000000000000000000000009",
        maxAllocation: "1.00",
        maxAllocationAsset: "test_usdg",
        assets: ["test_usdg"],
      });
      expect(permissionService.created[0].scopedContract).toBe(
        "0xOverride000000000000000000000000000001",
      );
    } finally {
      delete process.env.AMM_ROUTER_ADDRESS_OVERRIDE;
    }
  });
});

