import type { Page, APIResponse } from "@playwright/test";

export const PASSWORD = "pass1234";

export const USERS = {
  super: { email: "super@test.com", id: "t-super" },
  adminA: { email: "admin-a@test.com", id: "t-admin-a" },
  userA: { email: "user-a@test.com", id: "t-user-a" },
  userB: { email: "user-b@test.com", id: "t-user-b" },
};

export async function fetch2faCode(page: Page, email: string): Promise<string> {
  const res = await page.request.get(
    `/api/auth/2fa/test-code?email=${encodeURIComponent(email)}`,
  );
  if (!res.ok()) throw new Error(`No se pudo obtener código 2FA para ${email}`);
  const data = await res.json();
  return data.code as string;
}

export async function login(
  page: Page,
  email: string,
  password: string = PASSWORD,
): Promise<void> {
  const homeHeading = page.getByRole("heading", {
    name: /operacion de infraestructura OLVM/i,
  });

  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto("/login");
    await page
      .getByRole("textbox", { name: /correo electrónico/i })
      .fill(email);
    await page.getByRole("textbox", { name: /contraseña/i }).fill(password);
    await page.getByRole("button", { name: /continuar/i }).click();

    try {
      await page
        .getByText(/código de 6 dígitos/i)
        .waitFor({ state: "visible", timeout: 15_000 });
    } catch {
      continue; // reintentar si no aparece el paso 2
    }

    const code = await fetch2faCode(page, email);
    await page
      .getByRole("textbox", { name: /código de verificación/i })
      .fill(code);
    await page.getByRole("button", { name: /verificar e ingresar/i }).click();

    // Espera a aterrizar en el portal (H1 del home) o reintenta
    try {
      await homeHeading.waitFor({ state: "visible", timeout: 20_000 });
      return;
    } catch {
      // login falló (p.ej. flakiness de dev mode) → reintentar
    }
  }
  throw new Error(`Login fallido para ${email}`);
}

export async function logout(page: Page): Promise<void> {
  const btn = page.getByRole("button", { name: /cerrar sesion/i });
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
    await page.waitForURL(/\/login/, { timeout: 15_000 });
  }
}

// goto robusto: reintenta si la navegación se aborta (recarga por compilación en dev).
export async function gotoStable(page: Page, url: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      return;
    } catch {
      await page.waitForTimeout(1500);
    }
  }
  await page.goto(url);
}

// Espera a que la tabla de usuarios cargue (sale de "Cargando..."). Recarga si se atasca.
export async function waitForUsersTable(page: Page): Promise<void> {
  const marker = page
    .getByRole("row")
    .filter({ hasText: /Super Test|No hay usuarios/i })
    .first();
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await marker.waitFor({ state: "visible", timeout: 12_000 });
      return;
    } catch {
      await page.reload({ waitUntil: "domcontentloaded" });
    }
  }
}

export async function json(res: APIResponse): Promise<any> {
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
