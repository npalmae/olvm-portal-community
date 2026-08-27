import { NextResponse } from "next/server";
import { verifyUserCredentials } from "@/lib/userStore";
import {
  canRequestChallenge,
  createChallenge,
  msUntilCanResend,
} from "@/lib/twoFactor";
import { sendVerificationCode } from "@/lib/email";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { email?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email y contraseña son obligatorios" },
      { status: 400 },
    );
  }

  // Verifica credenciales antes de emitir un código (no revela si el email existe).
  const user = await verifyUserCredentials(email, password);
  if (!user) {
    return NextResponse.json(
      { error: "Credenciales inválidas" },
      { status: 401 },
    );
  }

  // Si el usuario tiene 2FA desactivado, no se envía código (login directo).
  if (user.twoFactorEnabled === false) {
    return NextResponse.json({ challenge: false });
  }

  // Cooldown anti-abuso entre reenvíos.
  if (!(await canRequestChallenge(email))) {
    const wait = Math.ceil((await msUntilCanResend(email)) / 1000);
    return NextResponse.json(
      { error: `Espera ${wait}s antes de reenviar el código` },
      { status: 429 },
    );
  }

  const code = await createChallenge(email);
  const result = await sendVerificationCode(user.email, code);

  return NextResponse.json({
    challenge: true,
    delivered: result.delivered,
    fallback: result.fallback,
    maskedEmail: maskEmail(user.email),
  });
}

const maskEmail = (email: string) => {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"•".repeat(Math.max(2, local.length - 2))}@${domain}`;
};
