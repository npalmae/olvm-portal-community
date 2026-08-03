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
} from "@/lib/olvmClient";
import { getOvaUploadPaths } from "@/lib/ovaStaging";

export const dynamic = "force-dynamic";
export const maxDuration = 600;
export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const asString = (value: unknown) => typeof value === "string" ? value.trim() : "";

const sshExec = async (hostAddress: string, command: string, timeoutMs = 300_000) => {
  const sshUser = process.env.OLVM_HOST_SSH_USER?.trim() || "root";
  const sshPassword = process.env.OLVM_HOST_SSH_PASSWORD?.trim();
  if (!sshPassword) throw new Error("OLVM_HOST_SSH_PASSWORD no está configurado");
  const { stdout } = await execFileAsync("sshpass", [
    "-p", sshPassword,
    "ssh", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null",
    `${sshUser}@${hostAddress}`,
    command,
  ], { timeout: timeoutMs, maxBuffer: 50 * 1024 * 1024 });
  return stdout;
};

const scpToHost = async (localPath: string, hostAddress: string, remotePath: string) => {
  const sshUser = process.env.OLVM_HOST_SSH_USER?.trim() || "root";
  const sshPassword = process.env.OLVM_HOST_SSH_PASSWORD?.trim();
  if (!sshPassword) throw new Error("OLVM_HOST_SSH_PASSWORD no está configurado");
  await execFileAsync("sshpass", [
    "-p", sshPassword,
    "scp",
    "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null",
    localPath,
    `${sshUser}@${hostAddress}:${remotePath}`,
  ], { timeout: 540_000, maxBuffer: 10 * 1024 * 1024 });
};

export async function POST(request: Request, context: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await context.params;
  let hostAddr = "";
  let extractDir = "";
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

    extractDir = `/tmp/ova-import-${Date.now()}`;
    const remoteOva = path.posix.join(hostStagingDir, `${uploadId || diskId}.ova`);

    if (isFromCatalog) {
      const { transferId, downloadUrl } = await downloadOvaFromSd(tenantId, diskId);
      await sshExec(hostAddr,
        `curl -sk -o '${remoteOva}' '${downloadUrl}'`,
        540_000,
      );
      await finalizeImageTransfer(tenantId, transferId);
    } else {
      const { filePath } = getOvaUploadPaths(uploadId);
      const fileInfo = await stat(filePath);
      if (!fileInfo.isFile() || fileInfo.size === 0) throw new Error("El archivo OVA no está disponible");
      await scpToHost(filePath, hostAddr, remoteOva);

      void uploadOvaAsDisk(tenantId, {
        name: ovaName || `${uploadId}.ova`,
        filePath,
        fileSize: fileInfo.size,
        storageDomainId,
      }).catch(() => undefined);
    }

    await sshExec(hostAddr, `mkdir -p ${extractDir} && tar -xf ${remoteOva} -C ${extractDir}/`);

    const vmdkName = (await sshExec(hostAddr, `find ${extractDir} -name '*.vmdk' -type f | head -1`)).trim();
    if (!vmdkName) throw new Error("El OVA no contiene un disco VMDK");

    const qcow2Path = `${extractDir}/disk.qcow2`;
    await sshExec(hostAddr, `qemu-img convert -p -f vmdk -O qcow2 '${vmdkName}' '${qcow2Path}'`, 540_000);

    const infoRaw = await sshExec(hostAddr, `qemu-img info --output=json '${qcow2Path}'`);
    const qcow2Info = JSON.parse(infoRaw);
    const virtualSize = Number(qcow2Info["virtual-size"]) || 10 * 1024 * 1024 * 1024;

    const { vmId } = await importOvaVm(tenantId, { name, clusterId, storageDomainId, hostId, hostPath: remoteOva });

    const newDiskName = `${name}-disk`;
    const newDiskId = await createUploadDisk(tenantId, {
      name: newDiskName,
      provisionedSize: virtualSize,
      storageDomainId,
    });

    const { transferId: upTransferId, uploadUrl } = await startImageTransfer(tenantId, newDiskId);

    await sshExec(hostAddr,
      `curl -sk -X PUT -H 'Content-Type: application/octet-stream' --data-binary @'${qcow2Path}' '${uploadUrl}'`,
      540_000,
    );

    await finalizeImageTransfer(tenantId, upTransferId);
    await waitForDiskReady(tenantId, newDiskId);
    await attachDiskToVm(tenantId, vmId, newDiskId, { bootable: true, interface: "virtio_scsi" });

    return NextResponse.json({ ok: true, vmId, pending: false });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  } finally {
    if (hostAddr && extractDir) {
      void sshExec(hostAddr, `rm -rf ${extractDir}`).catch(() => undefined);
    }
  }
}
