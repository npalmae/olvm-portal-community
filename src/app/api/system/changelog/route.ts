import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * F1 — Changelog integrado: sirve CHANGELOG.md del repo (copiado a la imagen).
 * El panel de sistema lo renderiza (Admin → Sistema).
 */
export async function GET() {
  try {
    const markdown = await readFile(path.join(process.cwd(), "CHANGELOG.md"), "utf8");
    return new NextResponse(markdown, {
      headers: { "Cache-Control": "no-store", "Content-Type": "text/markdown; charset=utf-8" },
    });
  } catch {
    return NextResponse.json({ error: "Changelog no disponible" }, { status: 404 });
  }
}
