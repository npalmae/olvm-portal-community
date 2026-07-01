import fs from "fs";
import os from "os";
import path from "path";

const BASE = "http://127.0.0.1:3100";
const SEED_EMAIL = "super@test.com";
const SEED_PASSWORD = "pass1234";

async function waitForServer(timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/login`);
      if (res.status === 200) return;
    } catch {
      // aún no listo
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("El servidor de prueba no respondió a tiempo");
}

// Compila rutas públicas para evitar recargas de Fast Refresh durante los tests.
async function publicWarmup() {
  const routes = [
    "/login",
    "/api/auth/csrf",
    "/api/auth/session",
    "/api/auth/providers",
    "/api/tenants",
    "/api/admin/users",
  ];
  for (const route of routes) {
    try {
      await fetch(`${BASE}${route}`);
    } catch {
      // noop
    }
  }
}

// Obtiene cookies de sesión realizando el flujo completo de 2FA por fetch.
async function getAuthenticatedCookie(): Promise<string> {
  const cookies: string[] = [];
  const collect = (res: Response) => {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const pair = c.split(";")[0];
      const name = pair.split("=")[0];
      const idx = cookies.findIndex((x) => x.startsWith(name + "="));
      if (idx >= 0) cookies[idx] = pair;
      else cookies.push(pair);
    }
  };
  const hdr = () => ({ cookie: cookies.join("; ") });

  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  collect(csrfRes);
  const csrf = (await csrfRes.json()).csrfToken;

  const chalRes = await fetch(`${BASE}/api/auth/2fa/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...hdr() },
    body: JSON.stringify({ email: SEED_EMAIL, password: SEED_PASSWORD }),
  });
  collect(chalRes);
  if (!chalRes.ok) throw new Error("warmup: challenge falló");

  const codeRes = await fetch(
    `${BASE}/api/auth/2fa/test-code?email=${encodeURIComponent(SEED_EMAIL)}`,
    { headers: hdr() },
  );
  const { code } = await codeRes.json();

  const cbRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...hdr(),
    },
    body: new URLSearchParams({
      csrfToken: csrf,
      email: SEED_EMAIL,
      password: SEED_PASSWORD,
      code,
      callbackUrl: `${BASE}/`,
      json: "true",
    }).toString(),
    redirect: "manual",
  });
  collect(cbRes);
  return cookies.join("; ");
}

// Compila páginas protegidas y rutas dinámicas autenticado.
async function authenticatedWarmup() {
  try {
    const cookie = await getAuthenticatedCookie();
    const hdr = { cookie };
    const authedRoutes = ["/", "/admin/users", "/api/admin/users"];
    for (const route of authedRoutes) {
      try {
        await fetch(`${BASE}${route}`, { headers: hdr });
      } catch {
        // noop
      }
    }
    // Rutas dinámicas con un id inexistente (compila el handler; responderá 404/400)
    const dyn = ["/api/admin/users/warmup-id", "/api/tenants/tenant-a/vms"];
    try {
      await fetch(`${BASE}/api/admin/users/warmup-id`, {
        method: "PATCH",
        headers: { ...hdr, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "x" }),
      });
    } catch {
      // noop
    }
    try {
      await fetch(`${BASE}/api/admin/users/warmup-id`, {
        method: "DELETE",
        headers: hdr,
      });
    } catch {
      // noop
    }
    for (const r of dyn) {
      try {
        await fetch(`${BASE}${r}`, { headers: hdr });
      } catch {
        // noop
      }
    }
  } catch {
    // Si el warmup autenticado falla, los tests igual corren (posible flakiness residual).
  }
  await new Promise((r) => setTimeout(r, 3000));
}

export default async function globalSetup() {
  const root = path.resolve(__dirname, "..", "..");
  const seed = path.join(root, "tests", "fixtures", "users.seed.json");
  // runtime FUERA del directorio del proyecto para no disparar Fast Refresh
  const runtime = path.join(os.tmpdir(), "olvm-test-users.json");
  fs.copyFileSync(seed, runtime);

  await waitForServer();
  await publicWarmup();
  await authenticatedWarmup();
}
