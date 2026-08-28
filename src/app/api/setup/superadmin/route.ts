import { NextResponse } from "next/server";
import { createInitialSuperadmin } from "@/lib/setupState";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!name || !email || !password) {
    return NextResponse.json({ error: "name, email y password son obligatorios" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "La contraseña debe tener al menos 8 caracteres" }, { status: 400 });
  }

  try {
    const userId = await createInitialSuperadmin({
      name,
      email,
      password,
    });
    if (!userId) {
      return NextResponse.json({ error: "El setup ya fue completado" }, { status: 403 });
    }
    return NextResponse.json({ ok: true, userId });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
