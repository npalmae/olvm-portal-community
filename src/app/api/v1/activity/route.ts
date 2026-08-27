import { NextResponse } from "next/server";
import { checkApiKey, unauthorizedResponse } from "@/lib/apiAuth";
import { listActivities } from "@/lib/activityStore";

export const dynamic = "force-dynamic";

// GET /api/v1/activity — actividades recientes visibles para la key
// superadmin: todos los tenants; usuarios: solo sus tenants
export async function GET(request: Request) {
  const ctx = await checkApiKey(request);
  if (!ctx) return unauthorizedResponse();

  try {
    const tenantIds = ctx.globalRole === "superadmin" ? null : ctx.tenantIds;
    const activities = await listActivities(tenantIds, 50);
    return NextResponse.json({
      total: activities.length,
      activities,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
