import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  transaction: vi.fn(),
  backupJobUpdateMany: vi.fn(),
  backupJobDeleteMany: vi.fn(),
  configUpdateMany: vi.fn(),
}));

vi.mock("./prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    backupJob: { updateMany: mocks.backupJobUpdateMany, deleteMany: mocks.backupJobDeleteMany },
    backupStorageConfig: { updateMany: mocks.configUpdateMany },
  },
}));
vi.mock("./backupStorage", () => ({
  deleteBackupObject: vi.fn(),
  getDecryptedBackupStorageConfig: mocks.getConfig,
  headBackupObject: vi.fn(),
  uploadBackupObject: vi.fn(),
}));

import { calculateNextRun, databaseArguments, recoverStaleBackupJobs, runDueBackups, serializeBackupJob } from "./backupService";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

const schedule = (frequency: "manual" | "6h" | "12h" | "daily" | "weekly" | "monthly", scheduleHour = 2, scheduleWeekday = 0) => ({
  frequency,
  scheduleHour,
  scheduleWeekday,
});

describe("calculateNextRun", () => {
  it("advances interval schedules from the supplied instant", () => {
    const from = new Date("2026-08-06T10:30:00.000Z");
    expect(calculateNextRun(schedule("6h"), from)?.toISOString()).toBe("2026-08-06T16:30:00.000Z");
    expect(calculateNextRun(schedule("12h"), from)?.toISOString()).toBe("2026-08-06T22:30:00.000Z");
  });

  it("calculates daily schedules using UTC", () => {
    expect(calculateNextRun(schedule("daily", 14), new Date("2026-08-06T10:30:00Z"))?.toISOString()).toBe("2026-08-06T14:00:00.000Z");
    expect(calculateNextRun(schedule("daily", 9), new Date("2026-08-06T10:30:00Z"))?.toISOString()).toBe("2026-08-07T09:00:00.000Z");
  });

  it("uses Sunday=0 for weekly schedules in UTC", () => {
    const from = new Date("2026-08-06T10:30:00Z"); // Thursday
    expect(calculateNextRun(schedule("weekly", 3, 1), from)?.toISOString()).toBe("2026-08-10T03:00:00.000Z");
  });

  it("runs monthly schedules on the first day at the UTC hour", () => {
    expect(calculateNextRun(schedule("monthly", 4), new Date("2026-08-06T10:30:00Z"))?.toISOString()).toBe("2026-09-01T04:00:00.000Z");
  });

  it("does not schedule manual backups", () => {
    expect(calculateNextRun(schedule("manual"), new Date("2026-08-06T10:30:00Z"))).toBeNull();
  });
});

describe("serializeBackupJob", () => {
  it("turns nullable BigInt sizes into JSON-safe strings", () => {
    const job = { id: "job-1", sizeBytes: BigInt("9007199254740993") } as Parameters<typeof serializeBackupJob>[0];
    const result = serializeBackupJob(job);
    expect(result.sizeBytes).toBe("9007199254740993");
    expect(() => JSON.stringify(result)).not.toThrow();
    expect(serializeBackupJob({ ...job, sizeBytes: null }).sizeBytes).toBeNull();
  });
});

describe("backup resilience", () => {
  it("recovers stale queued and running jobs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-06T12:00:00Z"));
    mocks.backupJobUpdateMany.mockResolvedValue({ count: 2 });

    await expect(recoverStaleBackupJobs()).resolves.toBe(2);
    expect(mocks.backupJobUpdateMany).toHaveBeenCalledWith({
      where: { status: { in: ["queued", "running"] }, createdAt: { lt: new Date("2026-08-06T10:00:00Z") } },
      data: {
        status: "failed", stage: "failed", finishedAt: new Date("2026-08-06T12:00:00Z"),
        error: "Backup failed: stale job recovered after restart",
      },
    });
  });

  it("excludes BackupJob data while preserving its schema", () => {
    const { args } = databaseArguments("postgresql://backup:secret@db:5432/portal?sslmode=require");
    expect(args).toContain('--exclude-table-data=public."BackupJob"');
    expect(args.some((arg) => arg.startsWith("--exclude-table="))).toBe(false);
  });

  it("does not consume a due schedule when an active job blocks creation", async () => {
    const due = new Date(Date.now() - 60_000);
    mocks.getConfig.mockResolvedValue({
      enabled: true, scheduleEnabled: true, frequency: "daily", scheduleHour: 2,
      scheduleWeekday: 0, nextRunAt: due, defaultProfile: "operational",
    });
    mocks.transaction.mockImplementation(async (callback) => callback({
      $queryRaw: vi.fn(),
      backupJob: { findFirst: vi.fn().mockResolvedValue({ id: "active" }), create: vi.fn() },
    }));

    await runDueBackups();
    expect(mocks.configUpdateMany).not.toHaveBeenCalled();
  });

  it("creates the scheduled job before advancing and removes it if the schedule claim is lost", async () => {
    const due = new Date(Date.now() - 60_000);
    const create = vi.fn().mockResolvedValue({ id: "scheduled-1", status: "queued" });
    mocks.getConfig.mockResolvedValue({
      enabled: true, scheduleEnabled: true, frequency: "daily", scheduleHour: 2,
      scheduleWeekday: 0, nextRunAt: due, defaultProfile: "operational",
    });
    mocks.transaction.mockImplementation(async (callback) => callback({
      $queryRaw: vi.fn(), backupJob: { findFirst: vi.fn().mockResolvedValue(null), create },
    }));
    mocks.configUpdateMany.mockResolvedValue({ count: 0 });
    mocks.backupJobDeleteMany.mockResolvedValue({ count: 1 });

    await runDueBackups();
    expect(create.mock.invocationCallOrder[0]).toBeLessThan(mocks.configUpdateMany.mock.invocationCallOrder[0]);
    expect(mocks.backupJobDeleteMany).toHaveBeenCalledWith({ where: { id: "scheduled-1", status: "queued" } });
  });
});
