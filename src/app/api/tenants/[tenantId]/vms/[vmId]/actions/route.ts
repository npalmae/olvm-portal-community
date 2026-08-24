import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { assertTenantAccess, isPlatformSuperadmin } from "@/lib/authz";
import { createOperationJob, runOperationJob, serializeOperationJob } from "@/lib/operationJobService";
import {
  enforceVmTagPolicy,
  fetchVmById,
  isSupportedAction,
} from "@/lib/olvmClient";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ tenantId: string; vmId: string }>;
};

export async function POST(request: Request, context: Params) {
  const { tenantId, vmId } = await context.params;
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    assertTenantAccess(session.user, tenantId, "user");
    if (!isPlatformSuperadmin(session.user)) {
      await enforceVmTagPolicy(tenantId, vmId);
    }

    const body = await request.json();
    const action = typeof body?.action === "string" ? body.action : "";
    if (!action) {
      return NextResponse.json(
        { error: "Action is required" },
        { status: 400 },
      );
    }

    let input: Record<string, unknown> | undefined;
    if (action === "clone") {
      assertTenantAccess(session.user, tenantId, "admin");
      const cloneName =
        typeof body?.cloneName === "string" ? body.cloneName.trim() : "";
      if (!cloneName) {
        return NextResponse.json(
          { error: "cloneName is required for clone action" },
          { status: 400 },
        );
      }
      input = { cloneName };
    }
    if (action !== "clone" && action !== "run_once_cd" && action !== "restart" && !isSupportedAction(action)) {
      return NextResponse.json(
        { error: `Unsupported action ${action}` },
        { status: 400 },
      );
    }

    const vm = await fetchVmById(tenantId, vmId);
    const job = await createOperationJob({
      tenantId, action, targetVmId: vmId,
      targetVmName: vm?.name,
      requestedBy: session.user.email!, origin: "portal", input,
    });
    void runOperationJob(job.id).catch(() => undefined);
    const statusUrl = `/api/tenants/${tenantId}/operation-jobs/${job.id}`;
    return NextResponse.json({ ok: true, job: serializeOperationJob(job), statusUrl }, { status: 202, headers: { Location: statusUrl } });
  } catch (error) {
    const message = (error as Error).message;
    const lower = message.toLowerCase();
    const status =
      lower.includes("tenant") || lower.includes("unsupported") ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
