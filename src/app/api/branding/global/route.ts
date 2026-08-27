import { NextResponse } from "next/server";
import { readBrandingConfig, LOGO_URL } from "@/lib/brandingStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const fetchCache = "force-no-store";

export async function GET() {
  const cfg = await readBrandingConfig();

  return NextResponse.json({
    brandName: cfg.brandName ?? "",
    hasLogo: Boolean(cfg.logoMime),
    logoUrl: cfg.logoMime ? LOGO_URL : null,
    logoWidth: cfg.logoWidth ?? 0,
    logoHeight: cfg.logoHeight ?? 0,
  });
}
