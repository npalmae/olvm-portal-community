import { NextResponse } from "next/server";
import { readLogo, readBrandingConfig } from "@/lib/brandingStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const fetchCache = "force-no-store";

export async function GET() {
  const cfg = await readBrandingConfig();
  const logo = await readLogo();

  if (!logo || !cfg.logoMime) {
    return new NextResponse(null, { status: 404 });
  }

  const mime = cfg.logoMime ?? "image/png";
  const headers = new Headers();
  headers.set("Content-Type", mime);
  headers.set("Content-Length", String(logo.length));
  headers.set("Cache-Control", "public, max-age=3600, must-revalidate");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Security-Policy", "default-src 'none'; img-src 'self'");

  return new NextResponse(new Uint8Array(logo), { status: 200, headers });
}
