import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isPlatformSuperadmin } from "@/lib/authz";
import { testConnection } from "@/lib/olvmClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isPlatformSuperadmin(session.user))
    return NextResponse.json({ error: "Forbidden: solo superadmin" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }

  if (typeof body.baseUrl !== "string" || !body.baseUrl.trim())
    return NextResponse.json({ error: "baseUrl es obligatorio para probar" }, { status: 400 });

  const result = await testConnection({
    baseUrl: body.baseUrl,
    username: typeof body.username === "string" ? body.username : undefined,
    password: typeof body.password === "string" ? body.password : undefined,
    token: typeof body.token === "string" ? body.token : undefined,
    allowInsecure: body.allowInsecure === true,
  });

  return NextResponse.json(result);
}
