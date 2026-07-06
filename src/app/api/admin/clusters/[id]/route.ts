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

const toPublic = (c: ClusterConnection) => {
  const engine = getEngineById(c.engineId);
  return {
    id: c.id,
    name: c.name,
    engineId: c.engineId,
    engineName: engine?.name ?? "N/D",
    engineUrl: engine?.baseUrl ?? "N/D",
    tag: c.tag,
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

  const existing = getClusterById(id);
  if (!existing) return NextResponse.json({ error: "Tenant no encontrado" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }

  try {
    const updated = updateCluster(id, {
      name: typeof body.name === "string" ? body.name : existing.name,
      engineId: typeof body.engineId === "string" ? body.engineId : existing.engineId,
      tag: typeof body.tag === "string" ? body.tag : existing.tag,
    });
    invalidateDispatcherCache(id);
    return NextResponse.json(toPublic(updated));
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

export async function DELETE(_: Request, context: Params) {
  const { id } = await context.params;
  const { denied } = await requireSuperadmin();
  if (denied) return NextResponse.json({ error: denied.message }, { status: denied.status });

  if (!getClusterById(id)) return NextResponse.json({ error: "Tenant no encontrado" }, { status: 404 });

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

  deleteCluster(id);
  invalidateDispatcherCache(id);
  return NextResponse.json({ ok: true });
}
