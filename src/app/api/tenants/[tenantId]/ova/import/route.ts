import { readFile, rm, stat } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { assertTenantAccess } from "@/lib/authz";
import { importOvaVm } from "@/lib/olvmClient";
import { getOvaUploadPaths, type OvaUploadMetadata } from "@/lib/ovaStaging";

export const dynamic = "force-dynamic";
export const maxDuration = 600;
export const runtime = "nodejs";

const asString = (value: unknown) => typeof value === "string" ? value.trim() : "";

export async function POST(request: Request, context: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await context.params;
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    assertTenantAccess(session.user, tenantId, "admin");

    const body = await request.json();
    const uploadId = asString(body?.uploadId);
    const name = asString(body?.name);
    const clusterId = asString(body?.clusterId);
    const storageDomainId = asString(body?.storageDomainId);
    if (!uploadId || !name || !clusterId || !storageDomainId) {
      return NextResponse.json(
        { error: "uploadId, name, clusterId y storageDomainId son obligatorios" },
        { status: 400 },
      );
    }

    const hostId = process.env.OVA_IMPORT_HOST_ID?.trim();
    const hostStagingDir = process.env.OVA_HOST_STAGING_DIR?.trim();
    if (!hostId || !hostStagingDir || !path.posix.isAbsolute(hostStagingDir)) {
      return NextResponse.json(
        { error: "Configura OVA_IMPORT_HOST_ID y OVA_HOST_STAGING_DIR con un directorio absoluto visible por el host OLVM" },
        { status: 500 },
      );
    }

    const { filePath, metadataPath } = getOvaUploadPaths(uploadId);
    const [fileInfo, metadataText] = await Promise.all([
      stat(filePath),
      readFile(metadataPath, "utf8"),
    ]);
    if (!fileInfo.isFile() || fileInfo.size === 0) throw new Error("El archivo OVA no está disponible");
    const metadata = JSON.parse(metadataText) as OvaUploadMetadata;
    if (metadata.tenantId !== tenantId) throw new Error("El OVA no pertenece al tenant seleccionado");

    const result = await importOvaVm(tenantId, {
      name,
      clusterId,
      storageDomainId,
      hostId,
      hostPath: path.posix.join(hostStagingDir, `${uploadId}.ova`),
    });
    await Promise.all([
      rm(filePath, { force: true }),
      rm(metadataPath, { force: true }),
    ]);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
