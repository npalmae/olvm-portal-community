import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { assertTenantAccess } from "@/lib/authz";
import { fetchTenantDiskSummary } from "@/lib/olvmClient";
import { engineTypeForTenant } from "@/lib/engineClient";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ tenantId: string }>;
};

export async function GET(_: Request, context: Params) {
  const { tenantId } = await context.params;
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    assertTenantAccess(session.user, tenantId, "operator");

    if ((await engineTypeForTenant(tenantId)) === "vmware") {
      return NextResponse.json({ totalSizeGB: 0, usedGB: 0, count: 0 });
    }
    const summary = await fetchTenantDiskSummary(tenantId);
    return NextResponse.json(summary);
  } catch (error) {
    const message = (error as Error).message;
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
