import { NextRequest, NextResponse } from "next/server";
import { verifyResetToken, consumeResetToken } from "@/lib/resetTokenStore";
import { getUserByEmail, updateUser } from "@/lib/userStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { token, password } = await req.json();
  if (!token || !password) {
    return NextResponse.json({ error: "Token y contraseña requeridos" }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "La contraseña debe tener al menos 6 caracteres" }, { status: 400 });
  }

  const reset = await verifyResetToken(token);
  if (!reset) {
    return NextResponse.json({ error: "Token inválido o expirado" }, { status: 400 });
  }

  const consumed = await consumeResetToken(token);
  if (!consumed) {
    return NextResponse.json({ error: "Token ya utilizado" }, { status: 400 });
  }

  const user = await getUserByEmail(reset.email);
  if (!user) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }

  await updateUser(user.id, { password });

  return NextResponse.json({ ok: true });
}
