import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { assertTenantAccess, isPlatformSuperadmin } from "@/lib/authz";
import { enforceVmTagPolicy, fetchVmDisks } from "@/lib/olvmClient";
import { fetchVmDiskDetails as fetchVmDiskDetailsVmware } from "@/lib/vmwareClient";
import { engineTypeForTenant } from "@/lib/engineClient";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ tenantId: string; vmId: string }>;
};

export async function GET(_: Request, context: Params) {
  const { tenantId, vmId } = await context.params;
  if ((await engineTypeForTenant(tenantId)) === "vmware") {
    try {
      const session = await auth();
      if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      assertTenantAccess(session.user, tenantId, "operator");
      return NextResponse.json(await fetchVmDiskDetailsVmware(tenantId, vmId));
    } catch (error) {
      return NextResponse.json({ error: (error as Error).message }, { status: 502 });
    }
  }
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    assertTenantAccess(session.user, tenantId, "operator");
    if (!isPlatformSuperadmin(session.user)) {
      await enforceVmTagPolicy(tenantId, vmId);
    }

    const disks = await fetchVmDisks(tenantId, vmId);
    return NextResponse.json(disks);
  } catch (error) {
    const message = (error as Error).message;
    const lower = message.toLowerCase();
    const status =
      lower.includes("tenant") || lower.includes("forbidden") ? 403 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
