import { NextResponse } from "next/server";
import { getPendingCode } from "@/lib/twoFactor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// SOLO para tests E2E. Devuelve el código 2FA pendiente de un email.
// Estrictamente deshabilitado salvo que E2E_TEST_MODE=1.
export async function GET(request: Request) {
  if (process.env.E2E_TEST_MODE !== "1") {
    return NextResponse.json({ error: "Not Found" }, { status: 404 });
  }
  const { searchParams } = new URL(request.url);
  const email = searchParams.get("email") ?? "";
  const code = await getPendingCode(email);
  if (!code) {
    return NextResponse.json({ error: "No hay código pendiente" }, { status: 404 });
  }
  return NextResponse.json({ code });
}
