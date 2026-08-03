import { NextResponse } from "next/server";
import { rm } from "fs/promises";
import { auth } from "@/auth";
import { assertTenantAccess } from "@/lib/authz";
import { listOvasByTenant, removeOvaFromLibrary } from "@/lib/ovaLibrary";
import { getOvaUploadPaths } from "@/lib/ovaStaging";

export const dynamic = "force-dynamic";

export async function GET(_: Request, ctx: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await ctx.params;
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    assertTenantAccess(session.user, tenantId);
    const ovas = await listOvasByTenant(tenantId);
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
    const ovaId = searchParams.get("id") ?? "";
    if (!ovaId) return NextResponse.json({ error: "id requerido" }, { status: 400 });

    const { filePath } = getOvaUploadPaths(ovaId);
    await rm(filePath, { force: true }).catch(() => undefined);
    await removeOvaFromLibrary(ovaId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
