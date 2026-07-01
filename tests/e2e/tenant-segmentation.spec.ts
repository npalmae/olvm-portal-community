import { test, expect } from "@playwright/test";
import { login, USERS, json } from "./helpers";

test.describe("Segmentación por tenant", () => {
  test("admin de tenant-a solo ve usuarios de su tenant", async ({ page }) => {
    await login(page, USERS.adminA.email);
    const res = await page.request.get("/api/admin/users");
    expect(res.ok()).toBeTruthy();
    const users = await json(res);
    const ids = users.map((u: any) => u.id);
    // Su propio tenant-a está visible
    expect(ids).toContain(USERS.userA.id);
    // tenant-b NO visible (aislamiento)
    expect(ids).not.toContain(USERS.userB.id);
    // Nota: super aparece porque tiene membresía en tenant-a (esperado);
    // pero admin-a no puede editarlo/eliminarlo (verificados en otros tests).
  });

  test("admin de tenant-a NO puede editar un usuario de tenant-b", async ({
    page,
  }) => {
    await login(page, USERS.adminA.email);
    const res = await page.request.patch(
      `/api/admin/users/${USERS.userB.id}`,
      { data: { name: "Hackeado" } },
    );
    expect(res.status()).toBe(403);
  });

  test("admin de tenant-a NO puede eliminar un usuario de tenant-b", async ({
    page,
  }) => {
    await login(page, USERS.adminA.email);
    const res = await page.request.delete(`/api/admin/users/${USERS.userB.id}`);
    expect(res.status()).toBe(403);
  });

  test("admin de tenant-a NO puede editar a un superadmin", async ({
    page,
  }) => {
    await login(page, USERS.adminA.email);
    const res = await page.request.patch(
      `/api/admin/users/${USERS.super.id}`,
      { data: { name: "Hackeado" } },
    );
    expect([403]).toContain(res.status());
  });

  test("usuario de tenant-a NO accede a VMs de tenant-b (middleware)", async ({
    page,
  }) => {
    await login(page, USERS.userA.email);
    const res = await page.request.get(`/api/tenants/tenant-b/vms`);
    expect([403, 404]).toContain(res.status());
  });

  test("superadmin ve todos los usuarios", async ({ page }) => {
    await login(page, USERS.super.email);
    const res = await page.request.get("/api/admin/users");
    const users = await json(res);
    const ids = users.map((u: any) => u.id);
    expect(ids).toContain(USERS.userA.id);
    expect(ids).toContain(USERS.userB.id);
    expect(ids).toContain(USERS.super.id);
  });

  test("admin de tenant-a solo puede ajustar el rol dentro de su tenant", async ({
    page,
  }) => {
    await login(page, USERS.adminA.email);
    // Promover user-a a admin dentro de tenant-a (permitido)
    const res = await page.request.patch(`/api/admin/users/${USERS.userA.id}`, {
      data: { membershipRole: "admin" },
    });
    expect(res.ok()).toBeTruthy();
    const u = await json(res);
    const membership = u.memberships.find(
      (m: any) => m.tenantId === "tenant-a",
    );
    expect(membership.role).toBe("admin");
  });
});
