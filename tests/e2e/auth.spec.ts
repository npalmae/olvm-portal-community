import { test, expect } from "@playwright/test";
import { login, logout, USERS, PASSWORD, json } from "./helpers";

test.describe("Autenticación y 2FA", () => {
  test("login superadmin con 2FA aterriza en el portal y muestra módulo de usuarios", async ({
    page,
  }) => {
    await login(page, USERS.super.email);
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("link", { name: /^usuarios$/i }),
    ).toBeVisible();
  });

  test("login de usuario regular oculta el módulo de administración", async ({
    page,
  }) => {
    await login(page, USERS.userA.email);
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("link", { name: /^usuarios$/i }),
    ).toHaveCount(0);
  });

  test("credenciales inválidas no emiten código", async ({ page, request }) => {
    const res = await request.post("/api/auth/2fa/challenge", {
      data: { email: USERS.super.email, password: "incorrecta" },
    });
    expect(res.status()).toBe(401);
    const body = await json(res);
    expect(body.error).toMatch(/inválidas/i);
  });

  test("código 2FA incorrecto bloquea el ingreso", async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[type="email"]').fill(USERS.adminA.email);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.getByRole("button", { name: /continuar/i }).click();
    await page.getByText(/código de 6 dígitos/i).waitFor({ state: "visible" });

    // Código deliberadamente erróneo
    await page.locator('input[autocomplete="one-time-code"]').fill("000000");
    await page.getByRole("button", { name: /verificar e ingresar/i }).click();

    await expect(page.getByText(/código incorrecto o expirado/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("logout lleva al login", async ({ page }) => {
    await login(page, USERS.super.email);
    await logout(page);
    await expect(page).toHaveURL(/\/login/);
  });

  test("usuario con 2FA desactivado entra sin código", async ({ page }) => {
    const email = `no2fa-${Date.now()}@test.com`;
    // superadmin crea un usuario con 2FA desactivado
    await login(page, USERS.super.email);
    const create = await page.request.post("/api/admin/users", {
      data: {
        email,
        password: PASSWORD,
        name: "No 2FA",
        tenantId: "tenant-a",
        role: "user",
        twoFactorEnabled: false,
      },
    });
    expect(create.ok()).toBeTruthy();
    await logout(page);

    // login: no debe aparecer el paso de código
    await page.goto("/login");
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.getByRole("button", { name: /continuar/i }).click();

    await page
      .getByRole("button", { name: /^salir$/i })
      .waitFor({ state: "visible", timeout: 20_000 });
    // confirma que no se mostró el paso de código
    await expect(page.getByText(/código de 6 dígitos/i)).toHaveCount(0);
  });
});
