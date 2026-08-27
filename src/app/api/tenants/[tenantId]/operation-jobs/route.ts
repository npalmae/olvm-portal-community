import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { assertTenantAccess } from "@/lib/authz";
import { listOperationJobs, serializeOperationJobsWithRequester } from "@/lib/operationJobService";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ tenantId: string }> };
export async function GET(request: Request, context: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { tenantId } = await context.params;
  try {
    assertTenantAccess(session.user, tenantId, "operator");
    const limit = Number(new URL(request.url).searchParams.get("limit")) || 50;
    return NextResponse.json(await serializeOperationJobsWithRequester(await listOperationJobs(tenantId, limit)));
  } catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 403 }); }
}
