import { test, expect } from "@playwright/test";
import { login, gotoStable, USERS, json } from "./helpers";

test.describe("Administración de conexiones OLVM", () => {
  test("superadmin ve la página y las conexiones seedeadas", async ({ page }) => {
    await login(page, USERS.super.email);
    await gotoStable(page, "/admin/clusters");
    await expect(
      page.getByRole("heading", { name: /conexiones olvm/i }),
    ).toBeVisible();
    // las conexiones sembradas desde OLVM_TENANTS aparecen
    await expect(page.getByText("tenant-a")).toBeVisible();
    await expect(page.getByText("tenant-b")).toBeVisible();
  });

  test("superadmin crea, edita y elimina una conexión (API)", async ({ page }) => {
    await login(page, USERS.super.email);
    const id = `ctest-${Date.now()}`;

    // crear
    const create = await page.request.post("/api/admin/clusters", {
      data: {
        id,
        name: "Cluster Test",
        baseUrl: "https://olvm-test.example/api",
        username: "admin@internal",
        password: "pass1234",
        allowInsecure: true,
      },
    });
    expect(create.status()).toBe(201);
    const created = await json(create);
    expect(created.id).toBe(id);

    // aparece en el listado
    const list = await json(await page.request.get("/api/admin/clusters"));
    expect(list.map((c: any) => c.id)).toContain(id);
    // sin secretos en la respuesta
    expect(JSON.stringify(list)).not.toContain("pass1234");

    // editar (cambiar nombre; password se conserva al no enviarlo)
    const upd = await page.request.patch(`/api/admin/clusters/${id}`, {
      data: { name: "Cluster Test Editado", baseUrl: created.baseUrl },
    });
    expect(upd.ok()).toBeTruthy();
    expect((await json(upd)).name).toBe("Cluster Test Editado");

    // eliminar
    const del = await page.request.delete(`/api/admin/clusters/${id}`);
    expect(del.ok()).toBeTruthy();

    const list2 = await json(await page.request.get("/api/admin/clusters"));
    expect(list2.map((c: any) => c.id)).not.toContain(id);
  });

  test("no se puede eliminar una conexión con usuarios asignados (409)", async ({
    page,
  }) => {
    await login(page, USERS.super.email);
    // tenant-a tiene usuarios asignados (user-a)
    const del = await page.request.delete("/api/admin/clusters/tenant-a");
    expect(del.status()).toBe(409);
    const body = await json(del);
    expect(body.error).toMatch(/usuario/i);
  });

  test("un admin de tenant NO puede gestionar conexiones (403)", async ({
    page,
  }) => {
    await login(page, USERS.adminA.email);
    const list = await page.request.get("/api/admin/clusters");
    expect(list.status()).toBe(403);
  });

  test("el listado no expone password ni token", async ({ page }) => {
    await login(page, USERS.super.email);
    const list = await json(await page.request.get("/api/admin/clusters"));
    for (const c of list) {
      expect(c).not.toHaveProperty("password");
      expect(c).not.toHaveProperty("token");
    }
  });
});
