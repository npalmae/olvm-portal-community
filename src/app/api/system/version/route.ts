import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PackageInfo = { version?: string };

const readPackageVersion = async (): Promise<string> => {
  try {
    const raw = await readFile(path.join(process.cwd(), "package.json"), "utf8");
    return (JSON.parse(raw) as PackageInfo).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
};

/**
 * F1 — Conciencia de versión (roadmap: módulo de gestión de actualizaciones).
 * Devuelve la versión del build; la fuente de verdad es el tag de git, que se
 * inyecta como PORTAL_VERSION en el build de la imagen (Dockerfile ARG).
 */
export async function GET() {
  const version = process.env.PORTAL_VERSION || (await readPackageVersion());
  const channel =
    process.env.PORTAL_CHANNEL ||
    (version.includes("-") || version === "0.0.0" ? "dev" : "stable");

  return NextResponse.json(
    {
      version,
      channel,
      commit: process.env.PORTAL_COMMIT || null,
      buildDate: process.env.PORTAL_BUILD_DATE || null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
