import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { assertTenantAccess, isPlatformSuperadmin } from "@/lib/authz";
import { createOperationJob, runOperationJob, serializeOperationJob } from "@/lib/operationJobService";
import {
  enforceVmTagPolicy,
  fetchVmById,
  updateVmResources,
} from "@/lib/olvmClient";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ tenantId: string; vmId: string }>;
};

const asPositiveNumber = (value: unknown) => {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : undefined;
};

export async function GET(_: Request, context: Params) {
  const { tenantId, vmId } = await context.params;
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    assertTenantAccess(session.user, tenantId, "operator");
    if (!isPlatformSuperadmin(session.user)) {
      await enforceVmTagPolicy(tenantId, vmId);
    }

    const vm = await fetchVmById(tenantId, vmId);
    return NextResponse.json(vm);
  } catch (error) {
    const message = (error as Error).message;
    const lower = message.toLowerCase();
    const status =
      lower.includes("tenant") || lower.includes("required") ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(request: Request, context: Params) {
  const { tenantId, vmId } = await context.params;
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    assertTenantAccess(session.user, tenantId, "admin");
    if (!isPlatformSuperadmin(session.user)) {
      await enforceVmTagPolicy(tenantId, vmId);
    }

    const body = await request.json();
    const memoryMB = asPositiveNumber(body?.memoryMB);
    const cpuCores = asPositiveNumber(body?.cpuCores);
    const sockets = asPositiveNumber(body?.sockets);

    if (!memoryMB && !cpuCores) {
      return NextResponse.json(
        { error: "Provide at least one field to update" },
        { status: 400 },
      );
    }

    await updateVmResources(tenantId, vmId, {
      memoryMB,
      cpuCores,
      sockets,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = (error as Error).message;
    const status = message.toLowerCase().includes("tenant") ? 400 : 500;
    return NextResponse.json(
      { error: message },
      { status },
    );
  }
}

export async function DELETE(_: Request, context: Params) {
  const { tenantId, vmId } = await context.params;
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    assertTenantAccess(session.user, tenantId, "admin");
    if (!isPlatformSuperadmin(session.user)) {
      await enforceVmTagPolicy(tenantId, vmId);
    }

    const vm = await fetchVmById(tenantId, vmId);
    const job = await createOperationJob({ tenantId, action: "delete", targetVmId: vmId, targetVmName: vm?.name,
      requestedBy: session.user.email!, origin: "portal" });
    void runOperationJob(job.id).catch(() => undefined);
    const statusUrl = `/api/tenants/${tenantId}/operation-jobs/${job.id}`;
    return NextResponse.json({ ok: true, job: serializeOperationJob(job), statusUrl }, { status: 202, headers: { Location: statusUrl } });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 502 },
    );
  }
}
