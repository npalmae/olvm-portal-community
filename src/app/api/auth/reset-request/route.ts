import { NextRequest, NextResponse } from "next/server";
import { getUserByEmail } from "@/lib/userStore";
import { createResetToken } from "@/lib/resetTokenStore";
import { sendPasswordResetEmail } from "@/lib/email";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { email } = await req.json();
  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Email requerido" }, { status: 400 });
  }

  const user = await getUserByEmail(email.trim().toLowerCase());
  if (!user) {
    return NextResponse.json({ ok: true });
  }

  const token = await createResetToken(user.email);
  const configuredOrigin = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;
  if (!configuredOrigin && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Servicio de recuperación no configurado" }, { status: 503 });
  }
  const origin = configuredOrigin ? new URL(configuredOrigin).origin : new URL(req.url).origin;
  const resetUrl = `${origin}/reset-password?token=${token}`;

  const result = await sendPasswordResetEmail(user.email, resetUrl);

  return NextResponse.json({
    ok: true,
    delivered: result.delivered,
    fallback: result.fallback,
  });
}
