import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { assertTenantAccess } from "@/lib/authz";
import { getOperationJob, serializeOperationJobWithRequester } from "@/lib/operationJobService";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ tenantId: string; jobId: string }> };
export async function GET(_: Request, context: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { tenantId, jobId } = await context.params;
  try {
    assertTenantAccess(session.user, tenantId, "operator");
    const job = await getOperationJob(tenantId, jobId);
    return job ? NextResponse.json(await serializeOperationJobWithRequester(job)) : NextResponse.json({ error: "Operation job not found" }, { status: 404 });
  } catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 403 }); }
}
