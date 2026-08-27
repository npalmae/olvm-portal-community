import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { assertTenantAccess, isPlatformSuperadmin } from "@/lib/authz";
import { addDiskToVm, enforceVmTagPolicy, fetchVmDiskDetails, deleteVmDisk } from "@/lib/olvmClient";

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
    const disks = await fetchVmDiskDetails(tenantId, vmId);
    return NextResponse.json(disks);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}

export async function POST(req: NextRequest, context: Params) {
  const { tenantId, vmId } = await context.params;
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    assertTenantAccess(session.user, tenantId, "admin");
    if (!isPlatformSuperadmin(session.user)) await enforceVmTagPolicy(tenantId, vmId);

    const body = await req.json();
    const sizeGB = Number(body.sizeGB);
    const storageDomainId = String(body.storageDomainId ?? "");

    if (!sizeGB || sizeGB < 1) {
      return NextResponse.json({ error: "sizeGB es requerido (min 1)" }, { status: 400 });
    }
    if (!storageDomainId) {
      return NextResponse.json({ error: "storageDomainId es requerido" }, { status: 400 });
    }

    await addDiskToVm(tenantId, vmId, {
      sizeGB,
      storageDomainId,
      name: body.name ? String(body.name) : undefined,
      interface: body.interface ? String(body.interface) : undefined,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest, context: Params) {
  const { tenantId, vmId } = await context.params;
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    assertTenantAccess(session.user, tenantId, "admin");
    if (!isPlatformSuperadmin(session.user)) await enforceVmTagPolicy(tenantId, vmId);

    const { searchParams } = new URL(req.url);
    const attachmentId = searchParams.get("attachmentId");
    const diskId = searchParams.get("diskId");

    if (!attachmentId || !diskId) {
      return NextResponse.json({ error: "attachmentId y diskId son requeridos" }, { status: 400 });
    }

    await deleteVmDisk(tenantId, vmId, attachmentId, diskId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
