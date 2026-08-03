import { readFile, rm, stat } from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { assertTenantAccess } from "@/lib/authz";
import { importOvaVm } from "@/lib/olvmClient";
import { getOvaUploadPaths, type OvaUploadMetadata } from "@/lib/ovaStaging";

export const dynamic = "force-dynamic";
export const maxDuration = 600;
export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const asString = (value: unknown) => typeof value === "string" ? value.trim() : "";

const scpToHost = async (localPath: string, hostAddress: string, remotePath: string) => {
  const sshUser = process.env.OLVM_HOST_SSH_USER?.trim() || "root";
  const sshPassword = process.env.OLVM_HOST_SSH_PASSWORD?.trim();
  if (!sshPassword) throw new Error("OLVM_HOST_SSH_PASSWORD no está configurado");

  await execFileAsync("sshpass", [
    "-p", sshPassword,
    "scp",
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=/dev/null",
    localPath,
    `${sshUser}@${hostAddress}:${remotePath}`,
  ], { timeout: 540_000, maxBuffer: 10 * 1024 * 1024 });

  await execFileAsync("sshpass", [
    "-p", sshPassword,
    "ssh",
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=/dev/null",
    `${sshUser}@${hostAddress}`,
    `mkdir -p ${path.posix.dirname(remotePath)}`,
  ], { timeout: 10_000 }).catch(() => undefined);
};

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
    const hostId = asString(body?.hostId);
    const hostAddress = asString(body?.hostAddress);
    if (!uploadId || !name || !clusterId || !storageDomainId || !hostId || !hostAddress) {
      return NextResponse.json(
        { error: "uploadId, name, clusterId, storageDomainId, hostId y hostAddress son obligatorios" },
        { status: 400 },
      );
    }

    const hostStagingDir = process.env.OVA_HOST_STAGING_DIR?.trim();
    if (!hostStagingDir || !path.posix.isAbsolute(hostStagingDir)) {
      return NextResponse.json(
        { error: "OVA_HOST_STAGING_DIR debe ser un directorio absoluto" },
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

    const remoteFile = path.posix.join(hostStagingDir, `${uploadId}.ova`);
    await scpToHost(filePath, hostAddress, remoteFile);

    const result = await importOvaVm(tenantId, {
      name,
      clusterId,
      storageDomainId,
      hostId,
      hostPath: remoteFile,
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
