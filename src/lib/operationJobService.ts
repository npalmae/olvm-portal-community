import type { OperationJob, Prisma } from "@prisma/client";
import { logActivity, type ActivityOrigin } from "./activityStore";
import { cloneVm, createVm, deleteVm, runOnceFromCd, sendVmAction } from "./olvmClient";
import { prisma } from "./prisma";

type JobInput = Record<string, unknown>;

export const serializeOperationJob = (job: OperationJob) => ({
  ...job,
  createdAt: job.createdAt.toISOString(), updatedAt: job.updatedAt.toISOString(),
  startedAt: job.startedAt?.toISOString() ?? null, finishedAt: job.finishedAt?.toISOString() ?? null,
});

export const createOperationJob = (input: {
  tenantId: string; action: string; targetVmId?: string; targetVmName?: string;
  requestedBy: string; origin: ActivityOrigin; input?: JobInput;
}) => prisma.operationJob.create({ data: { ...input, input: input.input as Prisma.InputJsonValue | undefined } });

export const listOperationJobs = (tenantId: string, limit = 50) => prisma.operationJob.findMany({
  where: { tenantId }, orderBy: { createdAt: "desc" }, take: Math.min(Math.max(limit, 1), 100),
});
export const getOperationJob = (tenantId: string, id: string) => prisma.operationJob.findFirst({ where: { id, tenantId } });

export const runOperationJob = async (id: string): Promise<void> => {
  const claimed = await prisma.operationJob.updateMany({
    where: { id, status: "queued" }, data: { status: "running", stage: "running", progress: 25, startedAt: new Date() },
  });
  if (!claimed.count) return;
  const job = await prisma.operationJob.findUniqueOrThrow({ where: { id } });
  const input = (job.input ?? {}) as JobInput;
  try {
    let resultVmId: string | null = null;
    if (job.action === "deploy") {
      await createVm(job.tenantId, input as Parameters<typeof createVm>[1]);
    } else if (job.action === "clone") {
      const cloned = await cloneVm(job.tenantId, job.targetVmId!, String(input.cloneName), async (stage, progress) => {
        await prisma.operationJob.update({ where: { id }, data: { stage, progress } });
      });
      resultVmId = cloned.vmId;
    } else if (job.action === "delete") {
      await deleteVm(job.tenantId, job.targetVmId!);
    } else if (job.action === "run_once_cd") {
      await runOnceFromCd(job.tenantId, job.targetVmId!);
    } else {
      await sendVmAction(job.tenantId, job.targetVmId!, job.action === "restart" ? "reboot" : job.action);
    }
    await prisma.operationJob.update({ where: { id }, data: {
      status: "completed", stage: "completed", progress: 100, resultVmId, finishedAt: new Date(),
    } });
    await logActivity({ tenantId: job.tenantId, userEmail: job.requestedBy, origin: job.origin as ActivityOrigin,
      action: job.action, status: "ok", vmId: job.targetVmId, vmName: job.targetVmName,
      detail: job.action === "clone" ? `→ ${String(input.cloneName)}` : undefined });
  } catch (error) {
    const message = (error as Error).message;
    await prisma.operationJob.update({ where: { id }, data: {
      status: "failed", stage: "failed", error: message, finishedAt: new Date(),
    } });
    await logActivity({ tenantId: job.tenantId, userEmail: job.requestedBy, origin: job.origin as ActivityOrigin,
      action: job.action, status: "error", vmId: job.targetVmId, vmName: job.targetVmName, detail: message });
  }
};
