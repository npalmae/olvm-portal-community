import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { assertTenantAccess, isPlatformSuperadmin } from "@/lib/authz";
import { enforceVmTagPolicy } from "@/lib/olvmClient";
import { convertVmToTemplate } from "@/lib/vmwareClient";
import { engineTypeForTenant } from "@/lib/engineClient";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ tenantId: string; vmId: string }>;
};

export async function POST(_req: Request, context: Params) {
  const { tenantId, vmId } = await context.params;
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    assertTenantAccess(session.user, tenantId, "admin");
    if ((await engineTypeForTenant(tenantId)) !== "vmware") {
      return NextResponse.json({ error: "Solo aplicable a engines VMware" }, { status: 400 });
    }
    if (!isPlatformSuperadmin(session.user)) await enforceVmTagPolicy(tenantId, vmId);
    await convertVmToTemplate(tenantId, vmId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
