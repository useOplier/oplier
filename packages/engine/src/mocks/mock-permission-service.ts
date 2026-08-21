import type { PermissionRef, PermissionScope, PermissionService } from "../types.js";

let counter = 0;

export class MockPermissionService implements PermissionService {
  created: PermissionScope[] = [];
  revoked: PermissionRef[] = [];

  async createPermission(scope: PermissionScope): Promise<PermissionRef> {
    counter += 1;
    this.created.push(scope);
    return { id: `perm_${counter}`, sessionReference: `mock-session-${counter}` };
  }

  async revokePermission(permissionRef: PermissionRef): Promise<void> {
    this.revoked.push(permissionRef);
  }
}
