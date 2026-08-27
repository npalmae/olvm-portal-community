import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn(),
  cloneVm: vi.fn(), logActivity: vi.fn(),
}));

vi.mock("./prisma", () => ({ prisma: { cloneJob: {
  updateMany: mocks.updateMany, update: mocks.update, findUniqueOrThrow: mocks.findUniqueOrThrow,
} } }));
vi.mock("./olvmClient", () => ({ cloneVm: mocks.cloneVm }));
vi.mock("./activityStore", () => ({ logActivity: mocks.logActivity }));

import { runCloneJob } from "./cloneJobService";

const job = {
  id: "job-1", tenantId: "tenant-1", sourceVmId: "source-1", sourceVmName: "source",
  cloneName: "clone", requestedBy: "user@example.com", origin: "api",
};

describe("runCloneJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUniqueOrThrow.mockResolvedValue(job);
    mocks.update.mockResolvedValue({});
  });

  it("persists real stages and logs only after completion", async () => {
    mocks.cloneVm.mockImplementation(async (_tenantId, _vmId, _name, progress) => {
      await progress("waiting", 35);
      expect(mocks.logActivity).not.toHaveBeenCalled();
      return { vmId: "clone-1", name: "clone" };
    });

    await runCloneJob(job.id);

    expect(mocks.update).toHaveBeenCalledWith({ where: { id: job.id }, data: { stage: "waiting", progress: 35 } });
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: job.id }, data: expect.objectContaining({ status: "completed", progress: 100, clonedVmId: "clone-1" }),
    }));
    expect(mocks.logActivity).toHaveBeenCalledOnce();
    expect(mocks.logActivity).toHaveBeenCalledWith(expect.objectContaining({ status: "ok", tenantId: "tenant-1" }));
  });

  it("persists failure before logging it", async () => {
    mocks.cloneVm.mockRejectedValue(new Error("OLVM failed"));
    await runCloneJob(job.id);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "failed", stage: "failed", error: "OLVM failed" }),
    }));
    expect(mocks.logActivity).toHaveBeenCalledWith(expect.objectContaining({ status: "error" }));
  });
});
