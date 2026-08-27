import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { assertTenantAccess, isPlatformSuperadmin } from "@/lib/authz";
import { fetchAllStorageDomains, fetchStorageDomains } from "@/lib/olvmClient";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ tenantId: string }>;
};

export async function GET(request: Request, context: Params) {
  const { tenantId } = await context.params;
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    assertTenantAccess(session.user, tenantId, "operator");

    const { searchParams } = new URL(request.url);
    const showAll = searchParams.get("all") === "1";

    const sds = isPlatformSuperadmin(session.user) && showAll
      ? await fetchAllStorageDomains(tenantId)
      : await fetchStorageDomains(tenantId);

    return NextResponse.json(sds);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
