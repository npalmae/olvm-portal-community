import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { assertTenantAccess } from "@/lib/authz";
import { fetchClusters, fetchTemplates, fetchNetworks, fetchVnicProfiles, fetchHosts } from "@/lib/olvmClient";
import { getTenantById } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await ctx.params;
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    assertTenantAccess(session.user, tenantId, "operator");

    const [clusters, templates, networks, vnicProfiles, hosts] = await Promise.all([
      fetchClusters(tenantId).catch(() => []),
      fetchTemplates(tenantId).catch(() => []),
      fetchNetworks(tenantId).catch(() => []),
      fetchVnicProfiles(tenantId).catch(() => []),
      fetchHosts(tenantId).catch(() => []),
    ]);
    const tenant = await getTenantById(tenantId);
    const networkConfig = tenant?.networkConfig ?? [];
    return NextResponse.json({ clusters, templates, networks, vnicProfiles, hosts, networkConfig });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
