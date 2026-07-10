import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { assertTenantAccess } from "@/lib/authz";
import { uploadIso } from "@/lib/olvmClient";

export const dynamic = "force-dynamic";
export const maxDuration = 600;
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await ctx.params;
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    assertTenantAccess(session.user, tenantId, "admin");

    const contentType = req.headers.get("content-type") ?? "";
    let fileName = "";
    let fileSize = 0;
    let fileBuffer: Buffer;
    let storageDomainId = "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      storageDomainId = formData.get("storageDomainId") as string;
      if (!file) return NextResponse.json({ error: "Archivo no encontrado" }, { status: 400 });
      fileName = file.name;
      fileSize = file.size;
      fileBuffer = Buffer.from(await file.arrayBuffer());
    } else {
      // Binary upload: headers carry metadata
      fileName = req.headers.get("x-file-name") ?? "upload.iso";
      storageDomainId = req.headers.get("x-storage-domain-id") ?? "";
      fileSize = Number(req.headers.get("content-length") ?? 0);
      fileBuffer = Buffer.from(await req.arrayBuffer());
    }

    if (!storageDomainId) return NextResponse.json({ error: "storageDomainId requerido" }, { status: 400 });
    if (fileSize === 0) return NextResponse.json({ error: "Archivo vacio" }, { status: 400 });

    await uploadIso(tenantId, fileName, fileSize, storageDomainId, fileBuffer);

    return NextResponse.json({ ok: true, name: fileName });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
