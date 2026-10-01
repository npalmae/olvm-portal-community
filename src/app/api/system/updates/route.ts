import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { auth } from "@/auth";
import { isPlatformSuperadmin } from "@/lib/authz";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * F2 — Detección de actualizaciones (roadmap: módulo de gestión de
 * actualizaciones). Compara la versión del build contra la última release
 * estable publicada en GitHub. Solo superadmins.
 *
 * Repo consultado: PORTAL_UPDATE_REPO (default: community, público).
 * Cache en memoria de 10 min para respetar rate-limits de la API.
 */
const UPDATE_REPO = process.env.PORTAL_UPDATE_REPO || "npalmae/olvm-portal-community";
const CACHE_TTL_MS = 10 * 60 * 1000;

type LatestRelease = {
  tag: string;
  url: string;
  notes: string;
  publishedAt: string | null;
};

type CacheEntry = { data: LatestRelease | null; at: number };
const cache = new Map<string, CacheEntry>();

const readPackageVersion = async (): Promise<string> => {
  try {
    const raw = await readFile(path.join(process.cwd(), "package.json"), "utf8");
    return (JSON.parse(raw) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
};

const parseSemver = (value: string): number[] => {
  const core = value.replace(/^v/, "").split("-")[0];
  return core.split(".").map((n) => Number.parseInt(n, 10) || 0);
};

const isNewer = (candidate: string, current: string): boolean => {
  const a = parseSemver(candidate);
  const b = parseSemver(current);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
};

const fetchLatest = async (): Promise<LatestRelease | null> => {
  const cached = cache.get(UPDATE_REPO);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;

  try {
    const res = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "olvm-portal-update-check" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const data = (await res.json()) as {
      tag_name?: string;
      html_url?: string;
      body?: string;
      published_at?: string;
    };
    const release: LatestRelease | null = data.tag_name
      ? {
          tag: data.tag_name,
          url: data.html_url ?? `https://github.com/${UPDATE_REPO}/releases/latest`,
          notes: data.body ?? "",
          publishedAt: data.published_at ?? null,
        }
      : null;
    cache.set(UPDATE_REPO, { data: release, at: Date.now() });
    return release;
  } catch {
    return cached?.data ?? null;
  }
};

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isPlatformSuperadmin(session.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const current = process.env.PORTAL_VERSION || (await readPackageVersion());
  const latest = await fetchLatest();

  return NextResponse.json(
    {
      current,
      channel: process.env.PORTAL_CHANNEL || (current.includes("-") ? "dev" : "stable"),
      latest: latest?.tag?.replace(/^v/, "") ?? null,
      available: latest ? isNewer(latest.tag, current) : false,
      releaseUrl: latest?.url ?? null,
      releaseNotes: latest?.notes ?? null,
      publishedAt: latest?.publishedAt ?? null,
      repo: UPDATE_REPO,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
