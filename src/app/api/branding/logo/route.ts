import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const fetchCache = "force-no-store";

export async function GET() {
  const row = await prisma.portalBranding.findUnique({ where: { id: 1 } });

  if (!row?.logoData) {
    return new NextResponse(null, { status: 404 });
  }

  const mime = row.logoMime ?? "image/png";
  const headers = new Headers();
  headers.set("Content-Type", mime);
  headers.set("Content-Length", String(row.logoData.length));
  headers.set("Cache-Control", "public, max-age=3600, must-revalidate");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Security-Policy", "default-src 'none'; img-src 'self'");

  return new NextResponse(row.logoData, { status: 200, headers });
}
