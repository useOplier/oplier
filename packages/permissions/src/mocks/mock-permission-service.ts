import { randomUUID } from "node:crypto";
import type {
  CheckPermissionResult,
  CreatePermissionParams,
  CreatePermissionResult,
  PermissionService,
} from "../types";

/**
 * Records `.created` / `.revoked` calls for assertions — same shape ENGINE_CONTRACT.md
 * describes for Part C's own `mocks/mock-permission-service.ts`, so this package's tests read
 * the same way Part C's do, and so this same mock could stand in for Part C's during
 * integration testing if useful.
 */
export class MockPermissionService implements PermissionService {
  readonly created: CreatePermissionParams[] = [];
  readonly revoked: string[] = [];

  /** Keyed by permissionRef — lets tests script per-permission valid/invalid/remaining-allowance
   *  responses, e.g. to exercise the "exceeds existing permission" blocked-state case without a
   *  live chain. Defaults to `{ valid: true }` if unset. */
  private readonly checkResponses = new Map<string, CheckPermissionResult>();

  async createPermission(params: CreatePermissionParams): Promise<CreatePermissionResult> {
    this.created.push(params);
    const permissionRef = `mock_perm_${randomUUID()}`;
    return { permissionRef, sessionData: { mock: true } };
  }

  async revokePermission(permissionRef: string): Promise<void> {
    this.revoked.push(permissionRef);
  }

  async checkPermissionValid(permissionRef: string): Promise<CheckPermissionResult> {
    return this.checkResponses.get(permissionRef) ?? { valid: true };
  }

  /** Test helper — script what `checkPermissionValid` returns for a given ref. */
  setCheckResponse(permissionRef: string, response: CheckPermissionResult): void {
    this.checkResponses.set(permissionRef, response);
  }
}
