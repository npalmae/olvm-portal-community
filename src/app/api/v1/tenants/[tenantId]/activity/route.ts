import { NextResponse } from "next/server";
import { apiRoleGate, checkApiKey, unauthorizedResponse } from "@/lib/apiAuth";
import { listActivities } from "@/lib/activityStore";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ tenantId: string }> };

// GET /api/v1/tenants/{t}/activity — actividades recientes del tenant (operator+)
export async function GET(request: Request, context: Params) {
  const ctx = await checkApiKey(request);
  if (!ctx) return unauthorizedResponse();
  const { tenantId } = await context.params;
  const denied = apiRoleGate(ctx, tenantId, "operator");
  if (denied) return denied;

  try {
    const activities = await listActivities([tenantId], 50);
    return NextResponse.json({ tenantId, activities });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
