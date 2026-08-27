import { NextResponse } from "next/server";
import { isSetupComplete } from "@/lib/setupState";
import { createUser } from "@/lib/userStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (await isSetupComplete()) {
    return NextResponse.json({ error: "El setup ya fue completado" }, { status: 403 });
  }

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
    const user = await createUser({
      name,
      email,
      password,
      role: "superadmin",
      tenantId: "",
      twoFactorEnabled: false,
    });
    return NextResponse.json({ ok: true, userId: user.id });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
