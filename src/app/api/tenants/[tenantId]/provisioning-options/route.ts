import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { assertTenantAccess } from "@/lib/authz";
import { fetchClusters, fetchTemplates, fetchNetworks, fetchVnicProfiles } from "@/lib/olvmClient";
import { getTenantById } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await ctx.params;
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    assertTenantAccess(session.user, tenantId);

    const [clusters, templates, networks, vnicProfiles] = await Promise.all([
      fetchClusters(tenantId).catch(() => []),
      fetchTemplates(tenantId).catch(() => []),
      fetchNetworks(tenantId).catch(() => []),
      fetchVnicProfiles(tenantId).catch(() => []),
    ]);
    const tenant = getTenantById(tenantId);
    const networkConfig = tenant?.networkConfig ?? [];
    return NextResponse.json({ clusters, templates, networks, vnicProfiles, networkConfig });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
