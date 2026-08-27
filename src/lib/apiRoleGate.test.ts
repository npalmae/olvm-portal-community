import { describe, expect, it } from "vitest";
import { apiRoleGateCore } from "./apiRoleGate";

const ctx = (globalRole: string | null, tenantRoles: Record<string, string>) => ({
  userId: "u1",
  userEmail: "test@example.com",
  globalRole,
  tenantIds: Object.keys(tenantRoles),
  tenantRoles,
});

describe("apiRoleGateCore", () => {
  it("permite todo a superadmin global en cualquier tenant", () => {
    expect(apiRoleGateCore(ctx("superadmin", {}), "produccion", "admin")).toEqual({ allowed: true });
  });

  it("bloquea tenant sin membership (fail-closed 403)", () => {
    const res = apiRoleGateCore(ctx(null, { produccion: "admin" }), "otro", "operator");
    expect(res.allowed).toBe(false);
    if (!res.allowed) expect(res.status).toBe(403);
  });

  it("operator solo puede leer", () => {
    expect(apiRoleGateCore(ctx(null, { t: "operator" }), "t", "operator").allowed).toBe(true);
    expect(apiRoleGateCore(ctx(null, { t: "operator" }), "t", "user").allowed).toBe(false);
    expect(apiRoleGateCore(ctx(null, { t: "operator" }), "t", "admin").allowed).toBe(false);
  });

  it("user puede desplegar y operar, pero no clonar ni borrar", () => {
    expect(apiRoleGateCore(ctx(null, { t: "user" }), "t", "user").allowed).toBe(true);
    expect(apiRoleGateCore(ctx(null, { t: "user" }), "t", "operator").allowed).toBe(true);
    expect(apiRoleGateCore(ctx(null, { t: "user" }), "t", "admin").allowed).toBe(false);
  });

  it("admin tiene todo dentro de su tenant", () => {
    expect(apiRoleGateCore(ctx(null, { t: "admin" }), "t", "admin").allowed).toBe(true);
    expect(apiRoleGateCore(ctx(null, { t: "admin" }), "t", "user").allowed).toBe(true);
  });

  it("el error indica el rol requerido y el propio", () => {
    const res = apiRoleGateCore(ctx(null, { t: "operator" }), "t", "user");
    expect(res.allowed).toBe(false);
    if (!res.allowed) {
      expect(res.error).toContain("requires role 'user'");
      expect(res.error).toContain("operator");
    }
  });
});
