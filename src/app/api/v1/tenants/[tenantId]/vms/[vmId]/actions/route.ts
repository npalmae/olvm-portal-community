import { NextResponse } from "next/server";
import { apiRoleGate, checkApiKey, unauthorizedResponse } from "@/lib/apiAuth";
import { logActivity } from "@/lib/activityStore";
import {
  cloneVm,
  enforceVmTagPolicy,
  isSupportedAction,
  runOnceFromCd,
  sendVmAction,
} from "@/lib/olvmClient";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ tenantId: string; vmId: string }> };

// POST /api/v1/tenants/{t}/vms/{vmId}/actions — operar VM segun perfil
//   user+: start | stop | restart | run_once_cd
//   admin+: clone
export async function POST(request: Request, context: Params) {
  const ctx = await checkApiKey(request);
  if (!ctx) return unauthorizedResponse();
  const { tenantId, vmId } = await context.params;

  try {
    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const action = typeof body.action === "string" ? body.action.trim() : "";
    if (!action) {
      return NextResponse.json({ error: "action is required" }, { status: 400 });
    }

    // clone exige admin; el resto exige user
    const minimumRole = action === "clone" ? "admin" : "user";
    const denied = apiRoleGate(ctx, tenantId, minimumRole);
    if (denied) return denied;

    // Aislamiento por tag: sin ser superadmin, la VM debe pertenecer al tenant
    if (ctx.globalRole !== "superadmin") {
      try {
        await enforceVmTagPolicy(tenantId, vmId);
      } catch {
        return NextResponse.json(
          { error: `Forbidden: VM ${vmId} does not belong to tenant ${tenantId}` },
          { status: 403 },
        );
      }
    }

    if (action === "clone") {
      const cloneName = typeof body.cloneName === "string" ? body.cloneName.trim() : "";
      if (!cloneName) {
        return NextResponse.json({ error: "cloneName is required for clone action" }, { status: 400 });
      }
      const cloned = await cloneVm(tenantId, vmId, cloneName);
      await logActivity({
        tenantId,
        userEmail: ctx.userEmail,
        origin: "api",
        action: "clone",
        status: "ok",
        vmId,
        detail: `→ ${cloneName}`,
      });
      return NextResponse.json({ ok: true, action, cloned });
    }

    if (action === "run_once_cd") {
      await runOnceFromCd(tenantId, vmId);
      await logActivity({
        tenantId, userEmail: ctx.userEmail, origin: "api", action, status: "ok", vmId,
      });
      return NextResponse.json({ ok: true, action });
    }

    if (!isSupportedAction(action)) {
      return NextResponse.json({ error: `Unsupported action ${action}` }, { status: 400 });
    }

    await sendVmAction(tenantId, vmId, action);
    await logActivity({
      tenantId, userEmail: ctx.userEmail, origin: "api", action, status: "ok", vmId,
    });
    return NextResponse.json({ ok: true, action, vmId });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
