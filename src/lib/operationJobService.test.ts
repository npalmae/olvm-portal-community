import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn(),
  sendVmAction: vi.fn(), cloneVm: vi.fn(), createVm: vi.fn(), deleteVm: vi.fn(), fetchVmById: vi.fn(), runOnceFromCd: vi.fn(), logActivity: vi.fn(),
}));
vi.mock("./prisma", () => ({ prisma: { operationJob: {
  updateMany: mocks.updateMany, update: mocks.update, findUniqueOrThrow: mocks.findUniqueOrThrow,
} } }));
vi.mock("./olvmClient", () => ({ sendVmAction: mocks.sendVmAction, cloneVm: mocks.cloneVm,
  createVm: mocks.createVm, deleteVm: mocks.deleteVm, fetchVmById: mocks.fetchVmById, runOnceFromCd: mocks.runOnceFromCd }));
vi.mock("./activityStore", () => ({ logActivity: mocks.logActivity }));
import { runOperationJob } from "./operationJobService";

describe("runOperationJob", () => {
  beforeEach(() => {
    vi.resetAllMocks(); mocks.updateMany.mockResolvedValue({ count: 1 }); mocks.update.mockResolvedValue({});
    mocks.findUniqueOrThrow.mockResolvedValue({ id: "j1", tenantId: "t1", action: "restart", targetVmId: "v1",
      targetVmName: "vm", requestedBy: "owner@example.com", origin: "api", input: null });
  });
  it("persists completion before activity and maps restart honestly", async () => {
    mocks.sendVmAction.mockImplementation(async () => expect(mocks.logActivity).not.toHaveBeenCalled());
    await runOperationJob("j1");
    expect(mocks.sendVmAction).toHaveBeenCalledWith("t1", "v1", "reboot");
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "completed", progress: 100 }) }));
    expect(mocks.logActivity).toHaveBeenCalledWith(expect.objectContaining({ userEmail: "owner@example.com", status: "ok" }));
  });
  it("persists failure and then logs it", async () => {
    mocks.sendVmAction.mockRejectedValue(new Error("failed"));
    await runOperationJob("j1");
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "failed", error: "failed" }) }));
    expect(mocks.logActivity).toHaveBeenCalledWith(expect.objectContaining({ status: "error" }));
  });
  it("waits for OLVM to report up before completing start", async () => {
    mocks.findUniqueOrThrow.mockResolvedValue({ id: "j1", tenantId: "t1", action: "start", targetVmId: "v1",
      targetVmName: "vm", requestedBy: "owner@example.com", origin: "api", input: null });
    mocks.fetchVmById.mockResolvedValue({ status: "up" });
    await runOperationJob("j1");
    expect(mocks.fetchVmById).toHaveBeenCalledWith("t1", "v1");
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: { stage: "waiting", progress: 60 } }));
  });
});
