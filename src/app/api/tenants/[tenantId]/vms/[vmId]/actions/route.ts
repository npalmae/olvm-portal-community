import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { assertTenantAccess, isPlatformSuperadmin } from "@/lib/authz";
import { logActivity } from "@/lib/activityStore";
import { createCloneJob, runCloneJob, serializeCloneJob } from "@/lib/cloneJobService";
import {
  enforceVmTagPolicy,
  isSupportedAction,
  runOnceFromCd,
  sendVmAction,
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
      const job = await createCloneJob({
        tenantId, sourceVmId: vmId,
        sourceVmName: typeof body?.sourceVmName === "string" ? body.sourceVmName.trim() : undefined,
        cloneName, requestedBy: session.user.email ?? "portal", origin: "portal",
      });
      void runCloneJob(job.id).catch(() => undefined);
      const statusUrl = `/api/tenants/${tenantId}/clone-jobs/${job.id}`;
      return NextResponse.json({ ok: true, job: serializeCloneJob(job), statusUrl }, {
        status: 202, headers: { Location: statusUrl },
      });
    }

    if (action === "run_once_cd") {
      await runOnceFromCd(tenantId, vmId);
      await logActivity({
        tenantId, userEmail: session.user.email ?? "portal", origin: "portal", action, status: "ok", vmId,
      });
      return NextResponse.json({ ok: true });
    }

    if (!isSupportedAction(action)) {
      return NextResponse.json(
        { error: `Unsupported action ${action}` },
        { status: 400 },
      );
    }

    await sendVmAction(tenantId, vmId, action);
    await logActivity({
      tenantId, userEmail: session.user.email ?? "portal", origin: "portal", action, status: "ok", vmId,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = (error as Error).message;
    const lower = message.toLowerCase();
    const status =
      lower.includes("tenant") || lower.includes("unsupported") ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
