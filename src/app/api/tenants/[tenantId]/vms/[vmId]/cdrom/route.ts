import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { assertTenantAccess } from "@/lib/authz";
import { mountIso, unmountIso, fetchCurrentIso } from "@/lib/olvmClient";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ tenantId: string; vmId: string }>;
};

export async function GET(_req: NextRequest, context: Params) {
  const { tenantId, vmId } = await context.params;
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    assertTenantAccess(session.user, tenantId);
    const isoId = await fetchCurrentIso(tenantId, vmId);
    return NextResponse.json({ isoId });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}

export async function PUT(req: NextRequest, context: Params) {
  const { tenantId, vmId } = await context.params;
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    assertTenantAccess(session.user, tenantId);

    const body = await req.json().catch(() => ({}));
    if (body.isoId) {
      await mountIso(tenantId, vmId, String(body.isoId));
      return NextResponse.json({ ok: true, mounted: body.isoId });
    } else {
      await unmountIso(tenantId, vmId);
      return NextResponse.json({ ok: true, mounted: null });
    }
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
