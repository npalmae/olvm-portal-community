import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { fetchVms } from "@/lib/olvmClient";
import { assertTenantAccess } from "@/lib/authz";
import { createOperationJob, runOperationJob, serializeOperationJob } from "@/lib/operationJobService";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ tenantId: string }>;
};

const asString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const asPositiveNumber = (value: unknown): number | undefined => {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : undefined;
};

export async function GET(_: Request, context: Params) {
  const { tenantId } = await context.params;
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    assertTenantAccess(session.user, tenantId, "operator");
    const vms = await fetchVms(tenantId);
    return NextResponse.json(vms);
  } catch (error) {
    const message = (error as Error).message;
    const status = message.toLowerCase().includes("tenant") ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: Request, context: Params) {
  try {
    const { tenantId } = await context.params;
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    assertTenantAccess(session.user, tenantId, "admin");

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
    const cloudInit = body?.cloudInit && typeof body.cloudInit === "object" ? body.cloudInit as { ip?: string; netmask?: string; gateway?: string; dns?: string } : undefined;

    if (!name || !clusterId) {
      return NextResponse.json(
        { error: "name and clusterId are required" },
        { status: 400 },
      );
    }

    const input = {
      name,
      clusterId,
      templateId: templateId || undefined,
      memoryMB,
      cpuCores,
      sockets,
      comment: comment || undefined,
      os: os || undefined,
      vnicProfileId: vnicProfileId || undefined,
      cloudInit,
    };
    const job = await createOperationJob({ tenantId, action: "deploy", targetVmName: name,
      requestedBy: session.user.email!, origin: "portal", input });
    void runOperationJob(job.id).catch(() => undefined);
    const statusUrl = `/api/tenants/${tenantId}/operation-jobs/${job.id}`;
    return NextResponse.json({ ok: true, job: serializeOperationJob(job), statusUrl }, { status: 202, headers: { Location: statusUrl } });
  } catch (error) {
    const message = (error as Error).message;
    const status = message.toLowerCase().includes("tenant") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
