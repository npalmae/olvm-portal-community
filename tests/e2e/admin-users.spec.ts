import { test, expect } from "@playwright/test";
import { login, gotoStable, waitForUsersTable, USERS, json } from "./helpers";

test.describe("Gestión de usuarios", () => {
  test("superadmin crea un usuario desde la UI", async ({ page }) => {
    await login(page, USERS.super.email);
    await gotoStable(page, "/admin/users");
    await waitForUsersTable(page);

    const email = `e2e-${Date.now()}@test.com`;
    await page.getByRole("button", { name: /\+ crear usuario/i }).click();
    await page.getByRole("textbox", { name: /^nombre$/i }).fill("Usuario E2E");
    await page.getByRole("textbox", { name: /email/i }).fill(email);
    await page
      .getByRole("textbox", { name: /contraseña/i })
      .fill("pass1234");
    await page.getByRole("button", { name: /^crear usuario$/i }).click();

    // El nuevo usuario aparece en el listado
    await expect(page.getByRole("cell", { name: email })).toBeVisible();
  });

  test("superadmin edita el nombre de un usuario desde la UI", async ({
    page,
  }) => {
    await login(page, USERS.super.email);
    await gotoStable(page, "/admin/users");
    await waitForUsersTable(page);

    const row = page.getByRole("row").filter({ hasText: "User A" }).first();
    await row.getByRole("button", { name: /editar/i }).click();

    const nameInput = page.getByRole("textbox", { name: /^nombre$/i });
    await nameInput.waitFor({ state: "visible" });
    await nameInput.fill("User A Editado");
    await page.getByRole("button", { name: /^guardar$/i }).click();

    await expect(
      page.getByRole("row").filter({ hasText: "User A Editado" }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("superadmin elimina un usuario desde la UI con confirmación", async ({
    page,
  }) => {
    await login(page, USERS.super.email);
    await gotoStable(page, "/admin/users");
    await waitForUsersTable(page);

    // Crea un usuario desechable dentro del propio test
    const email = `del-${Date.now()}@test.com`;
    await page.getByRole("button", { name: /\+ crear usuario/i }).click();
    await page.getByRole("textbox", { name: /^nombre$/i }).fill("Para Borrar");
    await page.getByRole("textbox", { name: /email/i }).fill(email);
    await page.getByRole("textbox", { name: /contraseña/i }).fill("pass1234");
    await page.getByRole("button", { name: /^crear usuario$/i }).click();
    await expect(page.getByRole("cell", { name: email })).toBeVisible();

    // Abre confirmación de eliminación
    const row = page.getByRole("row").filter({ hasText: email }).first();
    await row.getByRole("button", { name: /eliminar/i }).click();
    // Botón de confirmación en el modal
    await page.getByText(/no se puede deshacer/i).waitFor({ state: "visible" });
    await page.getByRole("button", { name: /^eliminar$/i }).last().click();

    await expect(page.getByRole("cell", { name: email })).toHaveCount(0);
  });

  test("no se puede eliminar la propia cuenta (botón deshabilitado)", async ({
    page,
  }) => {
    await login(page, USERS.super.email);
    await gotoStable(page, "/admin/users");
    await waitForUsersTable(page);

    const selfRow = page.getByRole("row").filter({ hasText: "Super Test" }).first();
    const deleteBtn = selfRow.getByRole("button", { name: /eliminar/i });
    await expect(deleteBtn).toBeDisabled();
  });

  test("API: no se puede eliminar la propia cuenta (400)", async ({
    page,
  }) => {
    await login(page, USERS.super.email);
    const res = await page.request.delete(`/api/admin/users/${USERS.super.id}`);
    expect(res.status()).toBe(400);
    const body = await json(res);
    expect(body.error).toMatch(/propia cuenta/i);
  });

  test("API: no se puede degradar al último superadmin (409)", async ({
    page,
  }) => {
    await login(page, USERS.super.email);
    const res = await page.request.patch(`/api/admin/users/${USERS.super.id}`, {
      data: { globalRole: null },
    });
    expect(res.status()).toBe(409);
    const body = await json(res);
    expect(body.error).toMatch(/último superadmin/i);
  });

  test("API: admin de tenant no puede crear superadmin", async ({ page }) => {
    await login(page, USERS.adminA.email);
    const res = await page.request.post("/api/admin/users", {
      data: {
        email: `evil-${Date.now()}@test.com`,
        password: "pass1234",
        name: "Evil",
        tenantId: "tenant-a",
        role: "superadmin",
      },
    });
    expect(res.status()).toBe(403);
    const body = await json(res);
    expect(body.error).toMatch(/superadmin/i);
  });
});
