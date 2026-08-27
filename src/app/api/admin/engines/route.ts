import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isPlatformSuperadmin } from "@/lib/authz";
import {
  createEngine,
  listEngines,
  type OlvmEngine,
} from "@/lib/engineStore";
import { invalidateDispatcherCache } from "@/lib/olvmClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

export async function GET() {
  const { denied } = await requireSuperadmin();
  if (denied) return NextResponse.json({ error: denied.message }, { status: denied.status });
  return NextResponse.json((await listEngines()).map(toPublic));
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
    const created = await createEngine({
      id: typeof body.id === "string" ? body.id : undefined,
      name: typeof body.name === "string" ? body.name : "",
      baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : "",
      username: typeof body.username === "string" ? body.username : undefined,
      password: typeof body.password === "string" ? body.password : undefined,
      token: typeof body.token === "string" ? body.token : undefined,
      allowInsecure: body.allowInsecure === true,
      caCert: typeof body.caCert === "string" ? body.caCert : undefined,
      sharedStorageDomains: Array.isArray(body.sharedStorageDomains)
        ? body.sharedStorageDomains.map(String)
        : undefined,
      brandName: typeof body.brandName === "string" ? body.brandName : undefined,
      brandLogoUrl: typeof body.brandLogoUrl === "string" ? body.brandLogoUrl : undefined,
    });
    invalidateDispatcherCache();
    return NextResponse.json(toPublic(created), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
