import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isPlatformSuperadmin } from "@/lib/authz";
import {
  deleteCluster,
  getClusterById,
  updateCluster,
  type ClusterConnection,
} from "@/lib/clusterStore";
import { getEngineById } from "@/lib/engineStore";
import { invalidateDispatcherCache } from "@/lib/olvmClient";
import { listUsers } from "@/lib/userStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = {
  params: Promise<{ id: string }>;
};

const toPublic = async (c: ClusterConnection) => {
  const engine = await getEngineById(c.engineId);
  return {
    id: c.id,
    name: c.name,
    engineId: c.engineId,
    engineName: engine?.name ?? "N/D",
    engineUrl: engine?.baseUrl ?? "N/D",
    tag: c.tag,
    storageDomains: c.storageDomains ?? [],
    networks: c.networks ?? [],
    networkConfig: c.networkConfig ?? [],
    createdAt: c.createdAt,
  };
};

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

  const existing = await getClusterById(id);
  if (!existing) return NextResponse.json({ error: "Tenant no encontrado" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }

  try {
    const updated = await updateCluster(id, {
      name: typeof body.name === "string" ? body.name : existing.name,
      engineId: typeof body.engineId === "string" ? body.engineId : existing.engineId,
      tag: typeof body.tag === "string" ? body.tag : existing.tag,
      storageDomains: Array.isArray(body.storageDomains)
        ? body.storageDomains.filter((s: unknown) => typeof s === "string")
        : existing.storageDomains,
      networks: Array.isArray(body.networks)
        ? body.networks.filter((s: unknown) => typeof s === "string")
        : existing.networks,
      networkConfig: Array.isArray(body.networkConfig)
        ? body.networkConfig as Array<{ name: string; prefix: string; mask: string }>
        : existing.networkConfig,
    });
    invalidateDispatcherCache(id);
    return NextResponse.json(await toPublic(updated));
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

export async function DELETE(_: Request, context: Params) {
  const { id } = await context.params;
  const { denied } = await requireSuperadmin();
  if (denied) return NextResponse.json({ error: denied.message }, { status: denied.status });

  if (!await getClusterById(id)) return NextResponse.json({ error: "Tenant no encontrado" }, { status: 404 });

  const affected = (await listUsers()).filter((u) =>
    u.memberships.some((m) => m.tenantId === id),
  );
  if (affected.length) {
    return NextResponse.json(
      {
        error: `No se puede eliminar: ${affected.length} usuario(s) asignado(s) a este tenant`,
        users: affected.map((u) => u.email),
      },
      { status: 409 },
    );
  }

  await deleteCluster(id);
  invalidateDispatcherCache(id);
  return NextResponse.json({ ok: true });
}
