import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isPlatformSuperadmin } from "@/lib/authz";
import {
  createCluster,
  listClusters,
  type ClusterConnection,
} from "@/lib/clusterStore";
import { getEngineById } from "@/lib/engineStore";
import { invalidateDispatcherCache, createTagIfNotExists } from "@/lib/olvmClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

export async function GET() {
  const { denied } = await requireSuperadmin();
  if (denied) return NextResponse.json({ error: denied.message }, { status: denied.status });
  return NextResponse.json(await Promise.all((await listClusters()).map(toPublic)));
}

export async function POST(request: Request) {
  const { denied } = await requireSuperadmin();
  if (denied) return NextResponse.json({ error: denied.message }, { status: denied.status });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }

  try {
    const created = await createCluster({
      id: typeof body.id === "string" ? body.id : undefined,
      name: typeof body.name === "string" ? body.name : "",
      engineId: typeof body.engineId === "string" ? body.engineId : "",
      tag: typeof body.tag === "string" ? body.tag : undefined,
      storageDomains: Array.isArray(body.storageDomains) ? body.storageDomains.filter((s: unknown) => typeof s === "string") : undefined,
      networks: Array.isArray(body.networks) ? body.networks.filter((s: unknown) => typeof s === "string") : undefined,
      networkConfig: Array.isArray(body.networkConfig) ? body.networkConfig as Array<{ name: string; prefix: string; mask: string }> : undefined,
    });
    invalidateDispatcherCache(created.id);

    // Crear el tag en OLVM si se definio uno
    if (created.tag) {
      try { await createTagIfNotExists(created.id, created.tag); } catch { /* best-effort */ }
    }

    return NextResponse.json(await toPublic(created), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
