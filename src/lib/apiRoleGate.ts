import type { ApiKeyContext } from "./apiKeyStore";

const ROLE_RANK: Record<string, number> = { operator: 0, user: 1, admin: 2 };

export type ApiRole = "operator" | "user" | "admin";

export type GateResult = { allowed: true } | { allowed: false; status: 403; error: string };

/**
 * Gate de permisos por perfil para la API v1 (logica pura, sin dependencias de Next).
 * - superadmin global: acceso total a cualquier tenant
 * - membership: ranking operator(0) < user(1) < admin(2)
 * - sin membership: fail-closed 403
 */
export const apiRoleGateCore = (
  ctx: ApiKeyContext,
  tenantId: string,
  minimumRole: ApiRole,
): GateResult => {
  if (ctx.globalRole === "superadmin") return { allowed: true };
  const role = ctx.tenantRoles[tenantId];
  if (!role) {
    return {
      allowed: false,
      status: 403,
      error: `Forbidden: no access to tenant ${tenantId}`,
    };
  }
  const have = ROLE_RANK[role] ?? -1;
  const need = ROLE_RANK[minimumRole];
  if (have < need) {
    return {
      allowed: false,
      status: 403,
      error: `Forbidden: this operation requires role '${minimumRole}' (your role: '${role}')`,
    };
  }
  return { allowed: true };
};
