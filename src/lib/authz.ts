import type { Session } from "next-auth";
import type { MembershipRole, TenantMembership } from "@/lib/userStore";

const roleRank: Record<MembershipRole, number> = {
  operator: 0,
  user: 1,
  admin: 2,
};

export const isPlatformSuperadmin = (
  user?: Session["user"] | null,
) => user?.globalRole === "superadmin" || user?.role === "superadmin";

export const getUserMemberships = (
  user?: Session["user"] | null,
): TenantMembership[] => user?.memberships ?? [];

export const getAccessibleTenantIds = (
  user?: Session["user"] | null,
): string[] =>
  Array.from(
    new Set(getUserMemberships(user).map((membership) => membership.tenantId)),
  );

export const getMembershipForTenant = (
  user: Session["user"] | null | undefined,
  tenantId: string,
) =>
  getUserMemberships(user).find((membership) => membership.tenantId === tenantId);

export const hasTenantAccess = (
  user: Session["user"] | null | undefined,
  tenantId: string,
  minimumRole: MembershipRole = "user",
) => {
  if (isPlatformSuperadmin(user)) return true;
  const membership = getMembershipForTenant(user, tenantId);
  if (!membership) return false;
  return roleRank[membership.role] >= roleRank[minimumRole];
};

export const assertTenantAccess = (
  user: Session["user"] | null | undefined,
  tenantId: string,
  minimumRole: MembershipRole = "user",
) => {
  if (hasTenantAccess(user, tenantId, minimumRole)) return;
  throw new Error(`Forbidden: no tienes acceso al tenant ${tenantId}`);
};

export const getDefaultTenantId = (
  user?: Session["user"] | null,
) => user?.defaultTenantId ?? user?.tenantId ?? getUserMemberships(user)[0]?.tenantId ?? "";
