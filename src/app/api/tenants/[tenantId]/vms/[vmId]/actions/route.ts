import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { assertTenantAccess, isPlatformSuperadmin } from "@/lib/authz";
import {
  cloneVm,
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
      const cloned = await cloneVm(tenantId, vmId, cloneName);
      return NextResponse.json({ ok: true, cloned });
    }

    if (action === "run_once_cd") {
      await runOnceFromCd(tenantId, vmId);
      return NextResponse.json({ ok: true });
    }

    if (!isSupportedAction(action)) {
      return NextResponse.json(
        { error: `Unsupported action ${action}` },
        { status: 400 },
      );
    }

    await sendVmAction(tenantId, vmId, action);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = (error as Error).message;
    const lower = message.toLowerCase();
    const status =
      lower.includes("tenant") || lower.includes("unsupported") ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
