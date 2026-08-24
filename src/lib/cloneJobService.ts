import type { CloneJob } from "@prisma/client";
import { logActivity, type ActivityOrigin } from "./activityStore";
import { cloneVm } from "./olvmClient";
import { prisma } from "./prisma";

export const serializeCloneJob = (job: CloneJob) => ({
  ...job,
  createdAt: job.createdAt.toISOString(),
  updatedAt: job.updatedAt.toISOString(),
  startedAt: job.startedAt?.toISOString() ?? null,
  finishedAt: job.finishedAt?.toISOString() ?? null,
});

export const createCloneJob = (input: {
  tenantId: string; sourceVmId: string; sourceVmName?: string;
  cloneName: string; requestedBy: string; origin: ActivityOrigin;
}) => prisma.cloneJob.create({ data: input });

export const listCloneJobs = (tenantId: string, limit = 50) => prisma.cloneJob.findMany({
  where: { tenantId }, orderBy: { createdAt: "desc" }, take: Math.min(Math.max(limit, 1), 100),
});

export const getCloneJob = (tenantId: string, id: string) => prisma.cloneJob.findFirst({
  where: { id, tenantId },
});

export const runCloneJob = async (id: string): Promise<void> => {
  const claimed = await prisma.cloneJob.updateMany({
    where: { id, status: "queued" },
    data: { status: "running", stage: "submitting", progress: 10, startedAt: new Date() },
  });
  if (!claimed.count) return;
  const job = await prisma.cloneJob.findUniqueOrThrow({ where: { id } });
  try {
    const cloned = await cloneVm(job.tenantId, job.sourceVmId, job.cloneName, async (stage, progress) => {
      await prisma.cloneJob.update({ where: { id }, data: { stage, progress } });
    });
    await prisma.cloneJob.update({
      where: { id }, data: { status: "completed", stage: "completed", progress: 100, clonedVmId: cloned.vmId, finishedAt: new Date() },
    });
    await logActivity({ tenantId: job.tenantId, userEmail: job.requestedBy, origin: job.origin as ActivityOrigin,
      action: "clone", status: "ok", vmId: job.sourceVmId, vmName: job.sourceVmName, detail: `→ ${job.cloneName}` });
  } catch (error) {
    const message = (error as Error).message;
    await prisma.cloneJob.update({
      where: { id }, data: { status: "failed", stage: "failed", error: message, finishedAt: new Date() },
    });
    await logActivity({ tenantId: job.tenantId, userEmail: job.requestedBy, origin: job.origin as ActivityOrigin,
      action: "clone", status: "error", vmId: job.sourceVmId, vmName: job.sourceVmName, detail: `${job.cloneName}: ${message}` });
  }
};
