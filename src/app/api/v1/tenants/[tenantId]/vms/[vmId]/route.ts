import { NextResponse } from "next/server";
import { apiRoleGate, checkApiKey, unauthorizedResponse } from "@/lib/apiAuth";
import { enforceVmTagPolicy, fetchVmById } from "@/lib/olvmClient";
import { createOperationJob, runOperationJob, serializeOperationJob } from "@/lib/operationJobService";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ tenantId: string; vmId: string }> };

// GET /api/v1/tenants/{t}/vms/{vmId} — detalle de VM (operator+)
export async function GET(request: Request, context: Params) {
  const ctx = await checkApiKey(request);
  if (!ctx) return unauthorizedResponse();
  const { tenantId, vmId } = await context.params;
  const denied = apiRoleGate(ctx, tenantId, "operator");
  if (denied) return denied;

  try {
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
    const vm = await fetchVmById(tenantId, vmId);
    if (!vm) return NextResponse.json({ error: "VM not found" }, { status: 404 });
    return NextResponse.json({ vm });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}

// DELETE /api/v1/tenants/{t}/vms/{vmId} — eliminar VM (admin+)
export async function DELETE(request: Request, context: Params) {
  const ctx = await checkApiKey(request);
  if (!ctx) return unauthorizedResponse();
  const { tenantId, vmId } = await context.params;
  const denied = apiRoleGate(ctx, tenantId, "admin");
  if (denied) return denied;

  try {
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
    const vm = await fetchVmById(tenantId, vmId);
    const job = await createOperationJob({ tenantId, action: "delete", targetVmId: vmId, targetVmName: vm?.name,
      requestedBy: ctx.userEmail, origin: "api" });
    void runOperationJob(job.id).catch(() => undefined);
    const statusUrl = `/api/v1/tenants/${tenantId}/operation-jobs/${job.id}`;
    return NextResponse.json({ ok: true, job: serializeOperationJob(job), statusUrl }, { status: 202, headers: { Location: statusUrl } });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
