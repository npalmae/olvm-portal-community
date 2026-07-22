import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const fetchCache = "force-no-store";

export async function GET() {
  const row = await prisma.portalBranding.findUnique({ where: { id: 1 } });

  return NextResponse.json({
    brandName: row?.brandName ?? "",
    hasLogo: Boolean(row?.logoData),
    logoUrl: row?.logoData ? "/api/branding/logo" : null,
    logoWidth: row?.logoWidth ?? 0,
    logoHeight: row?.logoHeight ?? 0,
  });
}
