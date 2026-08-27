import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { isPlatformSuperadmin } from "@/lib/authz";
import { fetchNetworks } from "@/lib/olvmClient";
import { getTenants } from "@/lib/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !isPlatformSuperadmin(session.user)) {
    return NextResponse.json({ error: "Solo superadmin" }, { status: 403 });
  }

  const { id: engineId } = await ctx.params;
  const tenants = await getTenants();
  const tenant = tenants.find((t) => t.engineId === engineId);
  if (!tenant) {
    return NextResponse.json([]);
  }

  try {
    const networks = await fetchNetworks(tenant.id, true);
    return NextResponse.json(networks.map((n) => n.name));
  } catch {
    return NextResponse.json([]);
  }
}
