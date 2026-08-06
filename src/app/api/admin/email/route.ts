import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { isPlatformSuperadmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { invalidateEmailConfigCache, sendTestEmail } from "@/lib/email";
import { decryptField, encryptField } from "@/lib/crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const requireSuperadmin = async () => {
  const session = await auth();
  if (!session?.user) return { denied: true as const, status: 401 };
  if (!isPlatformSuperadmin(session.user)) return { denied: true as const, status: 403 };
  return { denied: false as const };
};

export async function GET() {
  const check = await requireSuperadmin();
  if (check.denied) return NextResponse.json({ error: "Solo superadmin" }, { status: check.status });

  let row = await prisma.emailConfig.findUnique({ where: { id: 1 } });
  if (!row) {
    row = await prisma.emailConfig.create({
      data: {
        id: 1,
        provider: "resend",
        apiKey: encryptField(process.env.RESEND_API_KEY),
        fromAddress: process.env.RESEND_FROM ?? null,
        enabled: true,
      },
    });
  }

  return NextResponse.json({
    provider: row.provider,
    hasApiKey: Boolean(row.apiKey),
    apiKeyHint: row.apiKey ? "configured" : "",
    fromAddress: row.fromAddress ?? "",
    enabled: row.enabled,
  });
}

export async function PUT(req: NextRequest) {
  const check = await requireSuperadmin();
  if (check.denied) return NextResponse.json({ error: "Solo superadmin" }, { status: check.status });

  const body = await req.json();

  const existing = await prisma.emailConfig.findUnique({ where: { id: 1 } });
  const currentApiKey = existing?.apiKey ? decryptField(existing.apiKey) : undefined;
  const data = {
    provider: "resend",
    apiKey: encryptField(typeof body.apiKey === "string" && body.apiKey ? body.apiKey : currentApiKey),
    fromAddress: typeof body.fromAddress === "string" ? body.fromAddress : existing?.fromAddress ?? null,
    enabled: typeof body.enabled === "boolean" ? body.enabled : existing?.enabled ?? true,
  };

  const row = await prisma.emailConfig.upsert({
    where: { id: 1 },
    create: { id: 1, ...data },
    update: data,
  });

  invalidateEmailConfigCache();

  return NextResponse.json({
    provider: row.provider,
    hasApiKey: Boolean(row.apiKey),
    apiKeyHint: row.apiKey ? "configured" : "",
    fromAddress: row.fromAddress ?? "",
    enabled: row.enabled,
  });
}

export async function POST(req: NextRequest) {
  const check = await requireSuperadmin();
  if (check.denied) return NextResponse.json({ error: "Solo superadmin" }, { status: check.status });

  const body = await req.json().catch(() => ({}));
  const to = typeof body.to === "string" ? body.to : "";

  if (!to) return NextResponse.json({ error: "Email destino requerido" }, { status: 400 });

  const result = await sendTestEmail(to);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ ok: true });
}
