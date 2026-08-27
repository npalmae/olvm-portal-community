import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isPlatformSuperadmin } from "@/lib/authz";
import { getClusterById } from "@/lib/clusterStore";
import { getEngineById } from "@/lib/engineStore";
import { testConnection } from "@/lib/olvmClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = {
  params: Promise<{ id: string }>;
};

// POST /api/admin/clusters/[id]/test
// Resuelve el engine del tenant y prueba la conexion.
export async function POST(_: Request, context: Params) {
  const { id } = await context.params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isPlatformSuperadmin(session.user))
    return NextResponse.json({ error: "Forbidden: solo superadmin" }, { status: 403 });

  const cluster = await getClusterById(id);
  if (!cluster) return NextResponse.json({ error: "Tenant no encontrado" }, { status: 404 });

  const engine = await getEngineById(cluster.engineId);
  if (!engine) return NextResponse.json({ error: "Engine no encontrado para este tenant" }, { status: 404 });

  const result = await testConnection({
    baseUrl: engine.baseUrl,
    username: engine.username,
    password: engine.password,
    token: engine.token,
    allowInsecure: engine.allowInsecure,
    caCert: engine.caCert,
  });

  return NextResponse.json(result);
}
