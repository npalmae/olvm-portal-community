import { NextResponse } from "next/server";
import { apiRoleGate, checkApiKey, unauthorizedResponse } from "@/lib/apiAuth";
import { fetchVms } from "@/lib/olvmClient";
import { createOperationJob, runOperationJob, serializeOperationJob } from "@/lib/operationJobService";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ tenantId: string }> };

const asString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const asPositiveNumber = (value: unknown): number | undefined => {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : undefined;
};

// GET /api/v1/tenants/{tenantId}/vms — listar VMs del tenant (operator+)
export async function GET(request: Request, context: Params) {
  const ctx = await checkApiKey(request);
  if (!ctx) return unauthorizedResponse();
  const { tenantId } = await context.params;
  const denied = apiRoleGate(ctx, tenantId, "operator");
  if (denied) return denied;

  try {
    const vms = await fetchVms(tenantId);
    return NextResponse.json({
      tenantId,
      total: vms.length,
      up: vms.filter((v) => v.status?.toLowerCase() === "up").length,
      vms,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}

// POST /api/v1/tenants/{tenantId}/vms — desplegar VM nueva (user+)
export async function POST(request: Request, context: Params) {
  const ctx = await checkApiKey(request);
  if (!ctx) return unauthorizedResponse();
  const { tenantId } = await context.params;
  const denied = apiRoleGate(ctx, tenantId, "user");
  if (denied) return denied;

  try {
    const body = await request.json();
    const name = asString(body?.name);
    const clusterId = asString(body?.clusterId);
    const templateId = asString(body?.templateId);
    const memoryMB = asPositiveNumber(body?.memoryMB);
    const cpuCores = asPositiveNumber(body?.cpuCores);
    const sockets = asPositiveNumber(body?.sockets);
    const comment = asString(body?.comment);
    const os = asString(body?.os);
    const vnicProfileId = asString(body?.vnicProfileId);
    const cloudInit =
      body?.cloudInit && typeof body.cloudInit === "object"
        ? (body.cloudInit as { ip?: string; netmask?: string; gateway?: string; dns?: string })
        : undefined;

    if (!name || !clusterId || !templateId) {
      return NextResponse.json(
        { error: "name, clusterId and templateId are required" },
        { status: 400 },
      );
    }

    const input = {
      name,
      clusterId,
      templateId,
      memoryMB,
      cpuCores,
      sockets,
      comment: comment || undefined,
      os: os || undefined,
      vnicProfileId: vnicProfileId || undefined,
      cloudInit,
    };
    const job = await createOperationJob({ tenantId, action: "deploy", targetVmName: name,
      requestedBy: ctx.userEmail, origin: "api", input });
    void runOperationJob(job.id).catch(() => undefined);
    const statusUrl = `/api/v1/tenants/${tenantId}/operation-jobs/${job.id}`;
    return NextResponse.json({ ok: true, job: serializeOperationJob(job), statusUrl }, { status: 202, headers: { Location: statusUrl } });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
