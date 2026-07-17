import { NextRequest, NextResponse } from "next/server";
import { fetchClusters, fetchTemplates, fetchNetworks, fetchVnicProfiles } from "@/lib/olvmClient";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await ctx.params;
  try {
    const [clusters, templates, networks, vnicProfiles] = await Promise.all([
      fetchClusters(tenantId).catch(() => []),
      fetchTemplates(tenantId).catch(() => []),
      fetchNetworks(tenantId).catch(() => []),
      fetchVnicProfiles(tenantId).catch(() => []),
    ]);
    return NextResponse.json({ clusters, templates, networks, vnicProfiles });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
