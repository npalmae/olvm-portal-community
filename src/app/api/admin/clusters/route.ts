import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isPlatformSuperadmin } from "@/lib/authz";
import {
  createCluster,
  listClusters,
  type ClusterConnection,
} from "@/lib/clusterStore";
import { invalidateDispatcherCache } from "@/lib/olvmClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Vista pública: sin secretos (password/token), solo indicadores.
const toPublic = (c: ClusterConnection) => ({
  id: c.id,
  name: c.name,
  baseUrl: c.baseUrl,
  authMethod: c.token ? "token" : "basic",
  username: c.username,
  hasPassword: Boolean(c.password),
  hasToken: Boolean(c.token),
  allowInsecure: c.allowInsecure === true,
  tag: c.tag,
  hasCa: Boolean(c.caCert),
  createdAt: c.createdAt,
});

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
  if (denied) {
    return NextResponse.json({ error: denied.message }, { status: denied.status });
  }
  return NextResponse.json(listClusters().map(toPublic));
}

export async function POST(request: Request) {
  const { denied } = await requireSuperadmin();
  if (denied) {
    return NextResponse.json({ error: denied.message }, { status: denied.status });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  try {
    const created = createCluster({
      id: typeof body.id === "string" ? body.id : undefined,
      name: typeof body.name === "string" ? body.name : "",
      baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : "",
      username: typeof body.username === "string" ? body.username : undefined,
      password: typeof body.password === "string" ? body.password : undefined,
      token: typeof body.token === "string" ? body.token : undefined,
      allowInsecure: body.allowInsecure === true,
      tag: typeof body.tag === "string" ? body.tag : undefined,
      caCert: typeof body.caCert === "string" ? body.caCert : undefined,
    });
    invalidateDispatcherCache(created.id);
    return NextResponse.json(toPublic(created), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
