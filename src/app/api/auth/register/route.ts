import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isPlatformSuperadmin } from "@/lib/authz";
import { createUser, getUserByEmail } from "@/lib/userStore";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "El registro publico esta deshabilitado" }, { status: 403 });
    }
    if (!isPlatformSuperadmin(session.user)) {
      return NextResponse.json({ error: "Forbidden: solo superadmin" }, { status: 403 });
    }

    const body = await request.json();
    const { email, password, name, tenantId, role } = body ?? {};

    if (!email || !password || !name || !tenantId) {
      return NextResponse.json(
        { error: "Faltan campos obligatorios" },
        { status: 400 },
      );
    }

    const existing = await getUserByEmail(email);
    if (existing) {
      return NextResponse.json(
        { error: "El usuario ya existe" },
        { status: 409 },
      );
    }

    const user = await createUser({
      email,
      password,
      name,
      tenantId,
      role: role || "user",
    });

    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "Error creando usuario" },
      { status: 500 },
    );
  }
}
