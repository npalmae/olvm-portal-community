import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { assertTenantAccess, isPlatformSuperadmin } from "@/lib/authz";
import {
  addNicToVm,
  deleteNicFromVm,
  enforceVmTagPolicy,
  fetchVmNics,
  updateNicLink,
} from "@/lib/olvmClient";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ tenantId: string; vmId: string }>;
};

export async function GET(_req: NextRequest, context: Params) {
  const { tenantId, vmId } = await context.params;
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    assertTenantAccess(session.user, tenantId, "operator");
    if (!isPlatformSuperadmin(session.user)) await enforceVmTagPolicy(tenantId, vmId);
    const nics = await fetchVmNics(tenantId, vmId);
    return NextResponse.json(nics);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}

export async function POST(req: NextRequest, context: Params) {
  const { tenantId, vmId } = await context.params;
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isPlatformSuperadmin(session.user)) assertTenantAccess(session.user, tenantId, "admin");
    if (!isPlatformSuperadmin(session.user)) await enforceVmTagPolicy(tenantId, vmId);

    const body = await req.json();
    const vnicProfileId = String(body.vnicProfileId ?? "");
    if (!vnicProfileId) {
      return NextResponse.json({ error: "vnicProfileId es requerido" }, { status: 400 });
    }

    await addNicToVm(tenantId, vmId, {
      name: body.name ? String(body.name) : undefined,
      interface: body.interface ? String(body.interface) : undefined,
      vnicProfileId,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}

export async function PUT(req: NextRequest, context: Params) {
  const { tenantId, vmId } = await context.params;
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isPlatformSuperadmin(session.user)) assertTenantAccess(session.user, tenantId, "admin");
    if (!isPlatformSuperadmin(session.user)) await enforceVmTagPolicy(tenantId, vmId);

    const body = await req.json();
    const nicId = String(body.nicId ?? "");
    const linked = Boolean(body.linked);

    if (!nicId) {
      return NextResponse.json({ error: "nicId es requerido" }, { status: 400 });
    }

    await updateNicLink(tenantId, vmId, nicId, linked);
    return NextResponse.json({ ok: true, linked });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest, context: Params) {
  const { tenantId, vmId } = await context.params;
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isPlatformSuperadmin(session.user)) assertTenantAccess(session.user, tenantId, "admin");
    if (!isPlatformSuperadmin(session.user)) await enforceVmTagPolicy(tenantId, vmId);

    const { searchParams } = new URL(req.url);
    const nicId = searchParams.get("nicId");
    if (!nicId) {
      return NextResponse.json({ error: "nicId es requerido" }, { status: 400 });
    }

    await deleteNicFromVm(tenantId, vmId, nicId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
