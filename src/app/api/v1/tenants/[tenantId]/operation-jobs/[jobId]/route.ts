import { NextResponse } from "next/server";
import { apiRoleGate, checkApiKey, unauthorizedResponse } from "@/lib/apiAuth";
import { getOperationJob, serializeOperationJobWithRequester } from "@/lib/operationJobService";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ tenantId: string; jobId: string }> };
export async function GET(request: Request, context: Params) {
  const ctx = await checkApiKey(request);
  if (!ctx) return unauthorizedResponse();
  const { tenantId, jobId } = await context.params;
  const denied = apiRoleGate(ctx, tenantId, "operator");
  if (denied) return denied;
  const job = await getOperationJob(tenantId, jobId);
  return job ? NextResponse.json(await serializeOperationJobWithRequester(job)) : NextResponse.json({ error: "Operation job not found" }, { status: 404 });
}
