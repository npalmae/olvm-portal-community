import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { assertTenantAccess } from "@/lib/authz";
import { getCloneJob, serializeCloneJob } from "@/lib/cloneJobService";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ tenantId: string; jobId: string }> };

export async function GET(_request: Request, context: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { tenantId, jobId } = await context.params;
  try {
    assertTenantAccess(session.user, tenantId, "operator");
    const job = await getCloneJob(tenantId, jobId);
    return job ? NextResponse.json(serializeCloneJob(job)) : NextResponse.json({ error: "Clone job not found" }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 403 });
  }
}
