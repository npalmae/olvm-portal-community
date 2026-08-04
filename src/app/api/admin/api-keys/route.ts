import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isPlatformSuperadmin } from "@/lib/authz";
import { listApiKeys, createApiKey, deleteApiKey, toggleApiKey } from "@/lib/apiKeyStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user || !isPlatformSuperadmin(session.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const keys = await listApiKeys();
  return NextResponse.json(keys.map((k) => ({
    id: k.id,
    name: k.name,
    keyPreview: `${k.key.slice(0, 8)}…${k.key.slice(-4)}`,
    key: k.key,
    createdAt: k.createdAt,
    active: k.active,
    lastUsed: k.lastUsed,
  })));
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user || !isPlatformSuperadmin(session.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await request.json();
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Nombre requerido" }, { status: 400 });
  const created = await createApiKey(name);
  return NextResponse.json(created);
}

export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user || !isPlatformSuperadmin(session.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id") ?? "";
  const action = searchParams.get("action");

  if (action === "toggle") {
    await toggleApiKey(id);
  } else {
    await deleteApiKey(id);
  }
  return NextResponse.json({ ok: true });
}
