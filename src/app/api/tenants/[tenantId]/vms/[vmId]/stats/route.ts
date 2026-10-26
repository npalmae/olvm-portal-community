import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { assertTenantAccess } from "@/lib/authz";
import { fetchVmStats } from "@/lib/vmwareClient";
import { engineTypeForTenant } from "@/lib/engineClient";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ tenantId: string; vmId: string }>;
};

export async function GET(_req: Request, context: Params) {
  const { tenantId, vmId } = await context.params;
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    assertTenantAccess(session.user, tenantId, "operator");
    if ((await engineTypeForTenant(tenantId)) !== "vmware") {
      return NextResponse.json({ error: "Monitoreo disponible para engines VMware" }, { status: 400 });
    }
    return NextResponse.json(await fetchVmStats(tenantId, vmId));
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
