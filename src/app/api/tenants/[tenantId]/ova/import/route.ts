import { stat } from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { assertTenantAccess } from "@/lib/authz";
import {
  importOvaVm,
  createUploadDisk,
  startImageTransfer,
  finalizeImageTransfer,
  waitForDiskReady,
  attachDiskToVm,
  uploadOvaAsDisk,
  downloadOvaFromSd,
  fetchDiskName,
} from "@/lib/olvmClient";
import { getOvaUploadPaths } from "@/lib/ovaStaging";
import {
  getSystemSecretWithEnvFallback,
  SYSTEM_SECRET_KEYS,
} from "@/lib/systemSecretStore";

export const dynamic = "force-dynamic";
export const maxDuration = 600;
export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const asString = (value: unknown) => typeof value === "string" ? value.trim() : "";

type SshCredentials = { user: string; password: string };

const resolveSshCredentials = async (): Promise<SshCredentials> => {
  const sshUser = await getSystemSecretWithEnvFallback(SYSTEM_SECRET_KEYS.hostSshUser) || "root";
  const sshPassword = await getSystemSecretWithEnvFallback(SYSTEM_SECRET_KEYS.hostSshPassword);
  if (!sshPassword) throw new Error("OLVM_HOST_SSH_PASSWORD no está configurado");
  return { user: sshUser, password: sshPassword };
};

const sshExec = async (credentials: SshCredentials, hostAddress: string, command: string, timeoutMs = 300_000) => {
  const { stdout } = await execFileAsync("sshpass", [
    "-p", credentials.password,
    "ssh", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null",
    `${credentials.user}@${hostAddress}`,
    command,
  ], { timeout: timeoutMs, maxBuffer: 50 * 1024 * 1024 });
  return stdout;
};

const scpToHost = async (credentials: SshCredentials, localPath: string, hostAddress: string, remotePath: string) => {
  await execFileAsync("sshpass", [
    "-p", credentials.password,
    "scp",
    "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null",
    localPath,
    `${credentials.user}@${hostAddress}:${remotePath}`,
  ], { timeout: 540_000, maxBuffer: 10 * 1024 * 1024 });
};

export async function POST(request: Request, context: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await context.params;
  let hostAddr = "";
  let extractDir = "";
  let sshCredentials: SshCredentials | null = null;
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    assertTenantAccess(session.user, tenantId, "admin");

    const body = await request.json();
    const uploadId = asString(body?.uploadId);
    const diskId = asString(body?.diskId);
    const name = asString(body?.name);
    const clusterId = asString(body?.clusterId);
    const storageDomainId = asString(body?.storageDomainId);
    const hostId = asString(body?.hostId);
    hostAddr = asString(body?.hostAddress);
    const ovaName = asString(body?.ovaName);
    if (!name || !clusterId || !storageDomainId || !hostId || !hostAddr) {
      return NextResponse.json(
        { error: "name, clusterId, storageDomainId, hostId y hostAddress son obligatorios" },
        { status: 400 },
      );
    }
    const isFromCatalog = !!diskId && !uploadId;
    if (!isFromCatalog && !uploadId) {
      return NextResponse.json({ error: "uploadId o diskId son obligatorios" }, { status: 400 });
    }

    const hostStagingDir = process.env.OVA_HOST_STAGING_DIR?.trim();
    if (!hostStagingDir || !path.posix.isAbsolute(hostStagingDir)) {
      return NextResponse.json(
        { error: "OVA_HOST_STAGING_DIR debe ser un directorio absoluto" },
        { status: 500 },
      );
    }
    sshCredentials = await resolveSshCredentials();
    // OVA_HOST_STAGING_DIR debe existir en el host OLVM; se crea automáticamente si falta.
    await sshExec(sshCredentials, hostAddr, `mkdir -p '${hostStagingDir}'`);

    // Determina el formato de origen: qcow2 directo u OVA (tar).
    let sourceFormat: "ova" | "qcow2" = "ova";
    let stagedFilePath = "";
    let stagedFileSize = 0;
    if (isFromCatalog) {
      const catalogName = await fetchDiskName(tenantId, diskId);
      if (catalogName.toLowerCase().endsWith(".qcow2")) sourceFormat = "qcow2";
    } else {
      const qcow2Info = await stat(getOvaUploadPaths(uploadId, "qcow2").filePath).catch(() => null);
      if (qcow2Info?.isFile() && qcow2Info.size > 0) {
        sourceFormat = "qcow2";
        stagedFilePath = getOvaUploadPaths(uploadId, "qcow2").filePath;
        stagedFileSize = qcow2Info.size;
      } else {
        const ovaInfo = await stat(getOvaUploadPaths(uploadId, "ova").filePath).catch(() => null);
        if (!ovaInfo?.isFile() || ovaInfo.size === 0) throw new Error("El archivo OVA no está disponible");
        stagedFilePath = getOvaUploadPaths(uploadId, "ova").filePath;
        stagedFileSize = ovaInfo.size;
      }
    }

    extractDir = `/tmp/ova-import-${Date.now()}`;
    const remoteOva = path.posix.join(hostStagingDir, `${uploadId || diskId}.${sourceFormat}`);

    if (isFromCatalog) {
      const { transferId, downloadUrl } = await downloadOvaFromSd(tenantId, diskId);
      await sshExec(sshCredentials, hostAddr,
        `curl -sk -o '${remoteOva}' '${downloadUrl}'`,
        540_000,
      );
      await finalizeImageTransfer(tenantId, transferId);
    } else {
      await scpToHost(sshCredentials, stagedFilePath, hostAddr, remoteOva);
    }

    let diskPath: string;

    if (sourceFormat === "qcow2") {
      // Subida directa de qcow2: no hay OVA que extraer.
      diskPath = remoteOva;
    } else {
      await sshExec(sshCredentials, hostAddr, `mkdir -p ${extractDir} && tar -xf ${remoteOva} -C ${extractDir}/`);

      const qcow2Name = (await sshExec(sshCredentials, hostAddr, `find ${extractDir} -type f -iname '*.qcow2' | head -1`)).trim();
      const vmdkName = qcow2Name ? "" : (await sshExec(sshCredentials, hostAddr, `find ${extractDir} -type f -iname '*.vmdk' | head -1`)).trim();

      if (qcow2Name) {
        diskPath = qcow2Name;
      } else if (vmdkName) {
        diskPath = `${extractDir}/disk.qcow2`;
        await sshExec(sshCredentials, hostAddr, `qemu-img convert -p -f vmdk -O qcow2 '${vmdkName}' '${diskPath}'`, 540_000);
      } else {
        throw new Error("El OVA no contiene un disco soportado (qcow2 o vmdk)");
      }
    }

    const infoRaw = await sshExec(sshCredentials, hostAddr, `qemu-img info --output=json '${diskPath}'`);
    const diskInfo = JSON.parse(infoRaw) as { "virtual-size"?: number; "backing-filename"?: string };
    if (diskInfo["backing-filename"]) {
      // Aplana la cadena de backing files antes de subir.
      const flatPath = `${extractDir}/disk-flat.qcow2`;
      await sshExec(sshCredentials, hostAddr, `mkdir -p ${extractDir} && qemu-img convert -p -O qcow2 '${diskPath}' '${flatPath}'`, 540_000);
      diskPath = flatPath;
    }
    const virtualSize = Number(diskInfo["virtual-size"]) || 10 * 1024 * 1024 * 1024;

    const { vmId } = await importOvaVm(tenantId, { name, clusterId, storageDomainId, hostId, hostPath: remoteOva });

    const newDiskName = `${name}-disk`;
    const newDiskId = await createUploadDisk(tenantId, {
      name: newDiskName,
      provisionedSize: virtualSize,
      storageDomainId,
    });

    const { transferId: upTransferId, uploadUrl } = await startImageTransfer(tenantId, newDiskId);

    await sshExec(sshCredentials, hostAddr,
      `curl -sk -X PUT -H 'Content-Type: application/octet-stream' --data-binary @'${diskPath}' '${uploadUrl}'`,
      540_000,
    );

    await finalizeImageTransfer(tenantId, upTransferId);
    await waitForDiskReady(tenantId, newDiskId);
    await attachDiskToVm(tenantId, vmId, newDiskId, { bootable: true, interface: "virtio_scsi" });

    // Copia al catálogo del tenant (best-effort, no bloquea el resultado de la VM).
    let catalogWarning: string | null = null;
    if (!isFromCatalog) {
      try {
        await uploadOvaAsDisk(tenantId, {
          name: ovaName || `${uploadId}.${sourceFormat}`,
          filePath: stagedFilePath,
          fileSize: stagedFileSize,
          storageDomainId,
          virtualSize,
        });
      } catch (catalogError) {
        catalogWarning = (catalogError as Error).message;
        console.error("[ova-import] catalog copy failed:", catalogError);
      }
    }

    return NextResponse.json({ ok: true, vmId, pending: false, catalogWarning });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  } finally {
    if (hostAddr && extractDir && sshCredentials) {
      void sshExec(sshCredentials, hostAddr, `rm -rf ${extractDir}`).catch(() => undefined);
    }
  }
}
