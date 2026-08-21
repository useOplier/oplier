import { describe, expect, test } from "vitest";
import {
  InMemoryNexusPermissionRepository,
  MockPermissionService,
  SystemPermissionLifecycle,
  mapSystemScopeToPermissionSet,
  resolveExpirySec,
  toBaseUnits,
  toSelector,
  deriveEntityId,
  DEFAULT_PERMISSION_LIFETIME_SECONDS,
  type SystemStatusReader,
} from "../src/index";

const deps = {
  resolveAssetTokenAddress: async (assetId: string) =>
    assetId === "test_usdg"
      ? "0xa78e2baabaf5c4f36b7fc394725deb68d332eec1"
      : "0x3b5AF698A5F684AC723Ac2501B9183e875bFFd4A",
  // USDG is 6 decimals; the mock RWA tokens are 18.
  resolveAssetDecimals: async (assetId: string) => (assetId === "test_usdg" ? 6 : 18),
};

const baseScope = {
  systemId: "sys_1",
  userWallet: "0x1111111111111111111111111111111111111111",
  scopedContract: "0x80A90e3123cB073cCA547edF90C25B912D02B40c",
  scopedFunction: "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
  maxAllocation: "50",
  chainId: 1952,
};

describe("scope mapping against the real wallet_createSession permission model", () => {
  test("emits functions-on-contract scoped to the router and its swap selector", async () => {
    const set = await mapSystemScopeToPermissionSet({ ...baseScope, expiresAt: undefined }, deps, "test_usdg");
    const entry = set.permissions.find((p) => p.type === "functions-on-contract");
    expect(entry).toBeDefined();
    expect(entry).toMatchObject({
      type: "functions-on-contract",
      data: { address: baseScope.scopedContract },
    });
    // Must be a 4-byte selector on the wire, not the readable signature.
    const functions = (entry as { data: { functions: string[] } }).data.functions;
    expect(functions).toHaveLength(1);
    expect(functions[0]).toMatch(/^0x[0-9a-f]{8}$/);
    expect(functions[0]).toBe(toSelector(baseScope.scopedFunction));
  });

  test("never emits a root permission", async () => {
    const set = await mapSystemScopeToPermissionSet({ ...baseScope, expiresAt: undefined }, deps, "test_usdg");
    expect(set.permissions.some((p) => p.type === "root")).toBe(false);
  });

  test("spend limit uses the asset's real decimals, not a hardcoded 18", async () => {
    const set = await mapSystemScopeToPermissionSet({ ...baseScope, expiresAt: undefined }, deps, "test_usdg");
    const limit = set.permissions.find((p) => p.type === "erc20-token-transfer");
    // 50 USDG at 6 decimals = 50_000_000 = 0x2faf080. At a wrongly-assumed 18 decimals this would
    // be 50e18 — a 10^12 overstatement of the spend limit, which is the dangerous direction.
    //
    // Asserted as hex, not bigint: that is the wire format wallet_createSession requires, and sending
    // the bigint (serialized to the decimal string "50000000") is what Alchemy rejected in practice.
    // See the SessionPermission doc comment in scope-mapping.ts.
    expect(limit).toMatchObject({
      type: "erc20-token-transfer",
      data: { allowance: "0x2faf080", address: "0xa78e2baabaf5c4f36b7fc394725deb68d332eec1" },
    });
  });

  test("toBaseUnits truncates excess precision rather than rounding up", () => {
    expect(toBaseUnits("1.2345678", 6)).toBe(1_234_567n);
    expect(toBaseUnits("50", 6)).toBe(50_000_000n);
    expect(toBaseUnits("0.000001", 6)).toBe(1n);
  });

  test("refuses to create an unscoped session when no selectors resolve", async () => {
    await expect(
      mapSystemScopeToPermissionSet({ ...baseScope, scopedFunction: [], expiresAt: undefined }, deps, "test_usdg"),
    ).rejects.toThrow(/unscoped session/);
    // Whitespace-only entries are filtered out, so this is also an empty list.
    await expect(
      mapSystemScopeToPermissionSet({ ...baseScope, scopedFunction: ["  ", ""], expiresAt: undefined }, deps, "test_usdg"),
    ).rejects.toThrow(/unscoped session/);
  });

  test("a bare string is treated as ONE signature, never comma-split", async () => {
    // The regression guard for the old convention: this signature contains four commas, and
    // comma-splitting it produced un-hashable fragments like "swapExactTokensForTokens(uint256".
    const set = await mapSystemScopeToPermissionSet(
      { ...baseScope, scopedFunction: baseScope.scopedFunction, expiresAt: undefined },
      deps,
      "test_usdg",
    );
    const entry = set.permissions.find((p) => p.type === "functions-on-contract") as {
      data: { functions: string[] };
    };
    expect(entry.data.functions).toEqual(["0x38ed1739"]);
  });

  test("multiple signatures each resolve to their own selector", async () => {
    const set = await mapSystemScopeToPermissionSet(
      {
        ...baseScope,
        scopedFunction: [
          "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
          "approve(address,uint256)",
        ],
        expiresAt: undefined,
      },
      deps,
      "test_usdg",
    );
    const entry = set.permissions.find((p) => p.type === "functions-on-contract") as {
      data: { functions: string[] };
    };
    expect(entry.data.functions).toEqual(["0x38ed1739", "0x095ea7b3"]);
  });
});

describe("expirySec policy (a UPM must run for its real intended lifetime)", () => {
  const now = new Date("2026-08-19T12:00:00Z");

  test("uses the System's own expiresAt when set", () => {
    const expiresAt = new Date("2026-12-25T00:00:00Z");
    expect(resolveExpirySec(expiresAt, now)).toBe(Math.floor(expiresAt.getTime() / 1000));
  });

  test("defaults to a long lifetime when the System has no expiration", () => {
    const expected = Math.floor(now.getTime() / 1000) + DEFAULT_PERMISSION_LIFETIME_SECONDS;
    expect(resolveExpirySec(null, now)).toBe(expected);
    // Sanity: that default is a year, not hours — a short default would silently kill
    // long-running accumulation Systems (doc 01 §1's headline example).
    expect(DEFAULT_PERMISSION_LIFETIME_SECONDS).toBe(365 * 24 * 60 * 60);
  });

  test("refuses to mint an already-expired session key", () => {
    expect(() => resolveExpirySec(new Date("2026-08-19T11:00:00Z"), now)).toThrow(/already-expired/);
  });
});

describe("deriveEntityId", () => {
  test("is deterministic and survives a restart for the same systemId", () => {
    expect(deriveEntityId("sys_abc")).toBe(deriveEntityId("sys_abc"));
  });

  test("stays in the bottom half of uint32 and never collides with entity 0", () => {
    for (const id of ["sys_a", "sys_b", "0f8c1e2a-1111-2222-3333-444455556666", ""]) {
      const entity = deriveEntityId(id);
      expect(entity).toBeGreaterThan(0);
      expect(entity).toBeLessThan(0x80000000);
    }
  });
});

describe("checkBeforeExecution DB-status backstop (defence-in-depth for the revocation gap)", () => {
  type SystemStatus = "ACTIVE" | "PAUSED" | "HALTED" | "EXPIRED" | "COMPLETE" | null;

  function harness(status: SystemStatus) {
    const service = new MockPermissionService();
    const repository = new InMemoryNexusPermissionRepository();
    const statusReader: SystemStatusReader = { getSystemStatus: async () => status };
    const lifecycle = new SystemPermissionLifecycle(service, repository, statusReader);
    return { service, repository, lifecycle };
  }

  async function activate(h: ReturnType<typeof harness>) {
    return h.lifecycle.activate({
      systemId: "sys_1",
      userWallet: baseScope.userWallet,
      scopedContract: baseScope.scopedContract,
      scopedFunction: baseScope.scopedFunction,
      maxAllocation: "50",
    });
  }

  test("allows execution for an ACTIVE System with a valid permission", async () => {
    const h = harness("ACTIVE");
    await activate(h);
    const result = await h.lifecycle.checkBeforeExecution("sys_1", "10");
    expect(result.allowed).toBe(true);
  });

  test.each(["PAUSED", "HALTED", "EXPIRED", "COMPLETE"] as const)(
    "blocks execution when the System is %s, even though the session key is still valid",
    async (status) => {
      const h = harness(status);
      await activate(h);
      const result = await h.lifecycle.checkBeforeExecution("sys_1", "10");
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe(`system_status_${status.toLowerCase()}`);
    },
  );

  test("blocks execution when the System row is gone entirely (deleted)", async () => {
    const h = harness(null);
    await activate(h);
    const result = await h.lifecycle.checkBeforeExecution("sys_1", "10");
    expect(result.allowed).toBe(false);
    expect(result.state).toBe("REVOKED");
    expect(result.reason).toBe("system_deleted");
  });

  test("status is checked before the permission lookup, so a deleted System reports system_deleted", async () => {
    // No activate() at all — there is no permission row. Without the status gate ordering this
    // would surface the far less actionable "no_active_permission".
    const h = harness(null);
    const result = await h.lifecycle.checkBeforeExecution("sys_never_existed", "10");
    expect(result.reason).toBe("system_deleted");
  });
});
