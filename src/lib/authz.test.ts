import { describe, expect, it } from "vitest";
import type { Session } from "next-auth";
import { hasTenantAccess } from "./authz";

const userWithRole = (role: "operator" | "user" | "admin") => ({
  role,
  globalRole: null,
  memberships: [{ tenantId: "tenant-a", role }],
}) as Session["user"];

describe("tenant authorization ranks", () => {
  it("allows operators only when a read explicitly requests operator", () => {
    const operator = userWithRole("operator");
    expect(hasTenantAccess(operator, "tenant-a", "operator")).toBe(true);
    expect(hasTenantAccess(operator, "tenant-a")).toBe(false);
    expect(hasTenantAccess(operator, "tenant-a", "user")).toBe(false);
    expect(hasTenantAccess(operator, "tenant-a", "admin")).toBe(false);
  });

  it("keeps user and admin access ordered", () => {
    expect(hasTenantAccess(userWithRole("user"), "tenant-a", "operator")).toBe(true);
    expect(hasTenantAccess(userWithRole("user"), "tenant-a", "user")).toBe(true);
    expect(hasTenantAccess(userWithRole("user"), "tenant-a", "admin")).toBe(false);
    expect(hasTenantAccess(userWithRole("admin"), "tenant-a", "admin")).toBe(true);
  });

  it("denies absent tenant memberships and preserves superadmin bypass", () => {
    expect(hasTenantAccess(userWithRole("admin"), "tenant-b", "operator")).toBe(false);
    expect(hasTenantAccess({
      ...userWithRole("user"),
      role: "superadmin",
      globalRole: "superadmin",
      memberships: [],
    }, "tenant-b", "admin")).toBe(true);
  });
});
