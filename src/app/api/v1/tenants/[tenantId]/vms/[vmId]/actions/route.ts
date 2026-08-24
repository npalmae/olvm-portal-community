import { NextResponse } from "next/server";
import { apiRoleGate, checkApiKey, unauthorizedResponse } from "@/lib/apiAuth";
import { createOperationJob, runOperationJob, serializeOperationJob } from "@/lib/operationJobService";
import {
  enforceVmTagPolicy,
  fetchVmById,
  isSupportedAction,
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

    let input: Record<string, unknown> | undefined;
    if (action === "clone") {
      const cloneName = typeof body.cloneName === "string" ? body.cloneName.trim() : "";
      if (!cloneName) {
        return NextResponse.json({ error: "cloneName is required for clone action" }, { status: 400 });
      }
      input = { cloneName };
    }
    if (action !== "clone" && action !== "run_once_cd" && action !== "restart" && !isSupportedAction(action)) {
      return NextResponse.json({ error: `Unsupported action ${action}` }, { status: 400 });
    }

    const vm = await fetchVmById(tenantId, vmId);
    const job = await createOperationJob({
      tenantId, action, targetVmId: vmId,
      targetVmName: vm?.name,
      requestedBy: ctx.userEmail, origin: "api", input,
    });
    void runOperationJob(job.id).catch(() => undefined);
    const statusUrl = `/api/v1/tenants/${tenantId}/operation-jobs/${job.id}`;
    return NextResponse.json({ ok: true, action, job: serializeOperationJob(job), statusUrl }, { status: 202, headers: { Location: statusUrl } });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
