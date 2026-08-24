import { NextResponse } from "next/server";
import { apiRoleGate, checkApiKey, unauthorizedResponse } from "@/lib/apiAuth";
import { getCloneJob, serializeCloneJob } from "@/lib/cloneJobService";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ tenantId: string; jobId: string }> };

export async function GET(request: Request, context: Params) {
  const ctx = await checkApiKey(request);
  if (!ctx) return unauthorizedResponse();
  const { tenantId, jobId } = await context.params;
  const denied = apiRoleGate(ctx, tenantId, "operator");
  if (denied) return denied;
  const job = await getCloneJob(tenantId, jobId);
  return job ? NextResponse.json(serializeCloneJob(job)) : NextResponse.json({ error: "Clone job not found" }, { status: 404 });
}
