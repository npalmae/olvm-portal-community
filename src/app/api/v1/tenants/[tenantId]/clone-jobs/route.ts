import { NextResponse } from "next/server";
import { apiRoleGate, checkApiKey, unauthorizedResponse } from "@/lib/apiAuth";
import { listCloneJobs, serializeCloneJob } from "@/lib/cloneJobService";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ tenantId: string }> };

export async function GET(request: Request, context: Params) {
  const ctx = await checkApiKey(request);
  if (!ctx) return unauthorizedResponse();
  const { tenantId } = await context.params;
  const denied = apiRoleGate(ctx, tenantId, "operator");
  if (denied) return denied;
  const limit = Number(new URL(request.url).searchParams.get("limit")) || 50;
  return NextResponse.json((await listCloneJobs(tenantId, limit)).map(serializeCloneJob));
}
