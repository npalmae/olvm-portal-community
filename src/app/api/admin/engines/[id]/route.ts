import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isPlatformSuperadmin } from "@/lib/authz";
import {
  deleteEngine,
  getEngineById,
  updateEngine,
  type OlvmEngine,
} from "@/lib/engineStore";
import { invalidateDispatcherCache } from "@/lib/olvmClient";
import { listClusters } from "@/lib/clusterStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = {
  params: Promise<{ id: string }>;
};

const toPublic = (e: OlvmEngine) => ({
  id: e.id,
  name: e.name,
  baseUrl: e.baseUrl,
  authMethod: e.token ? "token" : "basic",
  username: e.username,
  hasPassword: Boolean(e.password),
  hasToken: Boolean(e.token),
  allowInsecure: e.allowInsecure === true,
  hasCa: Boolean(e.caCert),
  sharedStorageDomains: e.sharedStorageDomains ?? [],
  brandName: e.brandName ?? "",
  brandLogoUrl: e.brandLogoUrl ?? "",
  createdAt: e.createdAt,
});

const requireSuperadmin = async () => {
  const session = await auth();
  if (!session?.user) return { denied: { status: 401, message: "Unauthorized" } };
  if (!isPlatformSuperadmin(session.user)) {
    return { denied: { status: 403, message: "Forbidden: solo superadmin" } };
  }
  return { denied: null };
};

export async function PATCH(request: Request, context: Params) {
  const { id } = await context.params;
  const { denied } = await requireSuperadmin();
  if (denied) return NextResponse.json({ error: denied.message }, { status: denied.status });

  const existing = await getEngineById(id);
  if (!existing) return NextResponse.json({ error: "Engine no encontrado" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }

  const password =
    typeof body.password === "string" ? body.password
    : body.password === null ? undefined
    : existing.password;
  const token =
    typeof body.token === "string" ? body.token
    : body.token === null ? undefined
    : existing.token;

  try {
    const updated = await updateEngine(id, {
      name: typeof body.name === "string" ? body.name : existing.name,
      baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : existing.baseUrl,
      username: typeof body.username === "string" ? body.username : existing.username,
      password,
      token,
      allowInsecure: body.allowInsecure === true,
      caCert:
        typeof body.caCert === "string" ? body.caCert
        : body.caCert === null ? undefined
        : existing.caCert,
      sharedStorageDomains: Array.isArray(body.sharedStorageDomains)
        ? body.sharedStorageDomains.map(String)
        : existing.sharedStorageDomains,
      brandName: typeof body.brandName === "string" ? body.brandName : existing.brandName,
      brandLogoUrl: typeof body.brandLogoUrl === "string" ? body.brandLogoUrl : existing.brandLogoUrl,
    });
    invalidateDispatcherCache();
    return NextResponse.json(toPublic(updated));
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

export async function DELETE(_: Request, context: Params) {
  const { id } = await context.params;
  const { denied } = await requireSuperadmin();
  if (denied) return NextResponse.json({ error: denied.message }, { status: denied.status });

  if (!await getEngineById(id)) return NextResponse.json({ error: "Engine no encontrado" }, { status: 404 });

  const dependentTenants = (await listClusters()).filter((c) => c.engineId === id);
  if (dependentTenants.length) {
    return NextResponse.json(
      {
        error: `No se puede eliminar: ${dependentTenants.length} tenant(s) usan este engine`,
        tenants: dependentTenants.map((t) => t.name),
      },
      { status: 409 },
    );
  }

  await deleteEngine(id);
  invalidateDispatcherCache();
  return NextResponse.json({ ok: true });
}
