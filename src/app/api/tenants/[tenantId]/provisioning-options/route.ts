import { NextRequest, NextResponse } from "next/server";
import { fetchClusters, fetchTemplates } from "@/lib/olvmClient";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await ctx.params;
  try {
    const [clusters, templates] = await Promise.all([
      fetchClusters(tenantId).catch(() => []),
      fetchTemplates(tenantId).catch(() => []),
    ]);
    return NextResponse.json({ clusters, templates });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
