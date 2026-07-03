import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isPlatformSuperadmin } from "@/lib/authz";
import { getClusterById } from "@/lib/clusterStore";
import { testConnection } from "@/lib/olvmClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = {
  params: Promise<{ id: string }>;
};

// POST /api/admin/clusters/[id]/test
// Prueba una conexión guardada. El body opcional permite sobrescribir campos
// (p.ej. al editar); los ausentes se toman del store (incluye el password).
export async function POST(request: Request, context: Params) {
  const { id } = await context.params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isPlatformSuperadmin(session.user)) {
    return NextResponse.json(
      { error: "Forbidden: solo superadmin" },
      { status: 403 },
    );
  }

  const existing = getClusterById(id);
  if (!existing) {
    return NextResponse.json({ error: "Conexión no encontrada" }, { status: 404 });
  }

  let body: Record<string, unknown> = {};
  try {
    const text = await request.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }

  const result = await testConnection({
    baseUrl:
      typeof body.baseUrl === "string" ? body.baseUrl : existing.baseUrl,
    username:
      typeof body.username === "string" ? body.username : existing.username,
    password:
      typeof body.password === "string" && body.password
        ? body.password
        : existing.password,
    token:
      typeof body.token === "string" && body.token
        ? body.token
        : existing.token,
    allowInsecure:
      body.allowInsecure === undefined
        ? existing.allowInsecure
        : body.allowInsecure === true,
    caCert: existing.caCert,
  });

  return NextResponse.json(result);
}
