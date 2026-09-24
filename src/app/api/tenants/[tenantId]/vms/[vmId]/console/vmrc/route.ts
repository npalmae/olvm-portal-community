import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { assertTenantAccess, isPlatformSuperadmin } from "@/lib/authz";
import { engineTypeForTenant } from "@/lib/engineClient";
import { fetchVmrcConsoleUrl } from "@/lib/vmwareClient";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ tenantId: string; vmId: string }>;
};

export async function GET(_: Request, context: Params) {
  const { tenantId, vmId } = await context.params;
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    assertTenantAccess(session.user, tenantId, "user");
    if (!isPlatformSuperadmin(session.user)) {
      // fetchVmrcConsoleUrl aplica enforceVmTagPolicy internamente para no-admins
    }
    if ((await engineTypeForTenant(tenantId)) !== "vmware") {
      return NextResponse.json(
        { error: "Consola VMRC solo aplica a engines VMware" },
        { status: 501 },
      );
    }
    const url = await fetchVmrcConsoleUrl(tenantId, vmId);
    return NextResponse.json(
      { url },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
