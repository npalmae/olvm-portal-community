import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isPlatformSuperadmin } from "@/lib/authz";
import { getEngineById } from "@/lib/engineStore";
import { listClusters } from "@/lib/clusterStore";
import { fetchAllStorageDomains } from "@/lib/olvmClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = {
  params: Promise<{ id: string }>;
};

// GET /api/admin/engines/[id]/storage-domains
// Lista todos los storage domains del engine. Requiere superadmin.
export async function GET(_: Request, context: Params) {
  const { id } = await context.params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isPlatformSuperadmin(session.user))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const engine = await getEngineById(id);
  if (!engine) return NextResponse.json({ error: "Engine no encontrado" }, { status: 404 });

  // Buscar un tenant que use este engine para resolver la conexion
  const tenant = (await listClusters()).find((c) => c.engineId === id);
  if (!tenant) return NextResponse.json({ error: "No hay tenants asignados a este engine" }, { status: 400 });

  try {
    const sds = await fetchAllStorageDomains(tenant.id);
    return NextResponse.json(sds);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
