import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { assertTenantAccess } from "@/lib/authz";
import { fetchIsos } from "@/lib/olvmClient";
import { fetchIsos as fetchIsosVmware } from "@/lib/vmwareClient";
import { engineTypeForTenant } from "@/lib/engineClient";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ tenantId: string }>;
};

export async function GET(_req: NextRequest, context: Params) {
  const { tenantId } = await context.params;
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    assertTenantAccess(session.user, tenantId, "operator");
    if ((await engineTypeForTenant(tenantId)) === "vmware") {
      return NextResponse.json(await fetchIsosVmware(tenantId));
    }
    const isos = await fetchIsos(tenantId);
    return NextResponse.json(isos);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
