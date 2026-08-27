import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isPlatformSuperadmin } from "@/lib/authz";
import { listApiKeys, listKeysByUser, createApiKey, deleteApiKey, toggleApiKey } from "@/lib/apiKeyStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user || !isPlatformSuperadmin(session.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");
  const keys = userId ? await listKeysByUser(userId) : await listApiKeys();
  return NextResponse.json(keys.map((k) => ({
    id: k.id, name: k.name, userId: k.userId, userEmail: k.userEmail,
    keyPreview: `${k.key.slice(0, 8)}...`,
    createdAt: k.createdAt, active: k.active, lastUsed: k.lastUsed,
  })));
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user || !isPlatformSuperadmin(session.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await request.json();
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const userId = typeof body?.userId === "string" ? body.userId.trim() : "";
  const userEmail = typeof body?.userEmail === "string" ? body.userEmail.trim() : "";
  if (!name || !userId) return NextResponse.json({ error: "name y userId requeridos" }, { status: 400 });
  const created = await createApiKey(name, userId, userEmail);
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
  if (action === "toggle") await toggleApiKey(id);
  else await deleteApiKey(id);
  return NextResponse.json({ ok: true });
}
