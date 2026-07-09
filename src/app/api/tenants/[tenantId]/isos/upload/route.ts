import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { assertTenantAccess, isPlatformSuperadmin } from "@/lib/authz";
import { uploadIso } from "@/lib/olvmClient";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await ctx.params;
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    assertTenantAccess(session.user, tenantId, "admin");

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const storageDomainId = formData.get("storageDomainId") as string | null;

    if (!file) return NextResponse.json({ error: "Archivo no encontrado" }, { status: 400 });
    if (!storageDomainId) return NextResponse.json({ error: "storageDomainId requerido" }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    await uploadIso(tenantId, file.name, file.size, storageDomainId, buffer);

    return NextResponse.json({ ok: true, name: file.name });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
