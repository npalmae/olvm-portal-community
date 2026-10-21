import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { assertTenantAccess } from "@/lib/authz";
import { fetchOvaDisks, deleteOvaDisk } from "@/lib/olvmClient";
import { fetchOvaLibrary as fetchOvaLibraryVmware, deleteDatastoreFile } from "@/lib/vmwareClient";
import { getTenantById } from "@/lib/config";
import { engineTypeForTenant } from "@/lib/engineClient";

export const dynamic = "force-dynamic";

export async function GET(_: Request, ctx: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await ctx.params;
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    assertTenantAccess(session.user, tenantId, "operator");
    if ((await engineTypeForTenant(tenantId)) === "vmware") {
      return NextResponse.json(await fetchOvaLibraryVmware(tenantId));
    }
    const ovas = await fetchOvaDisks(tenantId);
    return NextResponse.json(ovas);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function DELETE(request: Request, ctx: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await ctx.params;
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    assertTenantAccess(session.user, tenantId, "admin");

    const { searchParams } = new URL(request.url);
    const diskId = searchParams.get("id") ?? "";
    if (!diskId) return NextResponse.json({ error: "id requerido" }, { status: 400 });

    if ((await engineTypeForTenant(tenantId)) === "vmware") {
      // id = "[DS] ova/<nombre>.ovf": borrar descriptor y su .ova par.
      const tenant = await getTenantById(tenantId);
      const ovaPath = diskId.replace(/\.ovf$/i, ".ova");
      await deleteDatastoreFile(tenant, diskId);
      await deleteDatastoreFile(tenant, ovaPath);
      return NextResponse.json({ ok: true });
    }
    await deleteOvaDisk(tenantId, diskId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
