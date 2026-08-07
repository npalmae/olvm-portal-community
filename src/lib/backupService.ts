import crypto from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { BackupJob } from "@prisma/client";
import {
  deleteBackupObject,
  getDecryptedBackupStorageConfig,
  headBackupObject,
  uploadBackupObject,
} from "./backupStorage";
import type { BackupProfile, BackupStorageConfig } from "./backupStorage";
import { prisma } from "./prisma";

const execFile = promisify(execFileCallback);
const ACTIVE_STATUSES = ["queued", "running"];
const CREATION_LOCK = 7_302_024_011;
const RUNTIME_ROOT = "/app";
const COMMAND_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;
const commandEnvironment: NodeJS.ProcessEnv = { PATH: process.env.PATH, NODE_ENV: process.env.NODE_ENV ?? "production" };

type BackupTrigger = "manual" | "scheduled";
type BackupStage = "queued" | "preparing" | "database" | "source" | "packaging" | "uploading" | "verifying" | "completed" | "failed";

class BackupFailure extends Error {
  constructor(readonly category: string) {
    super(category);
  }
}

const logBackupFailure = (id: string, stage: BackupStage, category: string): void => {
  const safeId = id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 128) || "unknown";
  console.error(`[backup] job=${safeId} stage=${stage} category=${category}`);
};

const runCommand = async (command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> => {
  try {
    await execFile(command, args, { env, timeout: COMMAND_TIMEOUT_MS, killSignal: "SIGKILL" });
  } catch (error) {
    const commandError = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string };
    const category = commandError.killed || commandError.signal === "SIGKILL" ? "command timeout" : "command failed";
    throw new BackupFailure(category);
  }
};

export const serializeBackupJob = (job: BackupJob) => ({
  ...job,
  sizeBytes: job.sizeBytes === null ? null : job.sizeBytes.toString(),
});

export const listBackupJobs = async (limit = 100): Promise<BackupJob[]> => prisma.backupJob.findMany({
  orderBy: { createdAt: "desc" },
  take: Math.max(1, Math.min(500, Math.trunc(limit) || 100)),
});

export const createBackupJob = async (profile: BackupProfile, trigger: BackupTrigger, requestedBy: string): Promise<BackupJob> => {
  if (profile !== "operational" && profile !== "full") throw new Error("Invalid backup profile");
  if (trigger !== "manual" && trigger !== "scheduled") throw new Error("Invalid backup trigger");
  if (!requestedBy.trim()) throw new Error("Backup requester is required");

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(${CREATION_LOCK})`;
    const active = await tx.backupJob.findFirst({ where: { status: { in: ACTIVE_STATUSES } }, select: { id: true } });
    if (active) throw new Error("A backup is already queued or running");
    return tx.backupJob.create({ data: { profile, trigger, requestedBy: requestedBy.trim() } });
  });
};

export const recoverStaleBackupJobs = async (maxAgeMs = 2 * 60 * 60 * 1000): Promise<number> => {
  const age = Number.isFinite(maxAgeMs) && maxAgeMs >= 0 ? maxAgeMs : 2 * 60 * 60 * 1000;
  const recovered = await prisma.backupJob.updateMany({
    where: { status: { in: ACTIVE_STATUSES }, createdAt: { lt: new Date(Date.now() - age) } },
    data: { status: "failed", stage: "failed", finishedAt: new Date(), error: "Backup failed: stale job recovered after restart" },
  });
  return recovered.count;
};

const updateStage = async (id: string, stage: BackupStage, progress: number): Promise<void> => {
  await prisma.backupJob.update({ where: { id }, data: { stage, progress } });
};

const checksumFile = async (path: string): Promise<string> => {
  const hash = crypto.createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
};

export const databaseArguments = (databaseUrl: string) => {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("Database configuration is invalid");
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") throw new Error("Database configuration is invalid");
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!url.hostname || !database || !url.username) throw new Error("Database configuration is invalid");
  return {
    args: [
      "--format=plain", "--no-owner", "--no-privileges", "--exclude-table-data=public.\"BackupJob\"",
      "--host", url.hostname, "--username", decodeURIComponent(url.username), "--dbname", database,
    ],
    env: {
      ...commandEnvironment,
      PGPORT: url.port || "5432",
      PGPASSWORD: decodeURIComponent(url.password),
      PGSSLMODE: url.searchParams.get("sslmode") || undefined,
    },
  };
};

const createDatabaseDump = async (destination: string): Promise<void> => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("Database configuration is missing");
  const command = databaseArguments(databaseUrl);
  await runCommand("pg_dump", [...command.args, "--file", destination], command.env);
  await runCommand("gzip", ["-9", destination], commandEnvironment);
};

const createSourceArchive = async (destination: string): Promise<void> => {
  const exclusions = [
    "node_modules", ".next", ".git", ".env", ".env.*", "data", "ova-staging", "ova_staging",
    "build", "dist", "coverage", "*.ova", "*.iso", "*.qcow2", "*.vmdk", "*.pem", "*.key", "*.p12", "*.pfx",
  ];
  const args = ["-czf", destination, ...exclusions.map((value) => `--exclude=${value}`), "-C", RUNTIME_ROOT, "."];
  await runCommand("tar", args, commandEnvironment);
};

const applyRetention = async (config: BackupStorageConfig, currentJobId: string): Promise<void> => {
  const completed = await prisma.backupJob.findMany({
    where: { status: "completed", objectKey: { not: null }, id: { not: currentJobId } },
    orderBy: { createdAt: "desc" },
  });
  const cutoff = Date.now() - config.retentionDays * 24 * 60 * 60 * 1000;
  const expired = completed.filter((job, index) => index >= config.retentionCount - 1 || job.createdAt.getTime() < cutoff);
  for (const job of expired) {
    if (!job.objectKey) continue;
    try {
      await deleteBackupObject(config, job.objectKey);
      await prisma.backupJob.update({ where: { id: job.id }, data: { status: "expired", objectKey: null } });
    } catch {
      // Retention is best-effort; a later successful backup will retry the object.
    }
  }
};

export const runBackupJob = async (id: string): Promise<BackupJob> => {
  const claimed = await prisma.backupJob.updateMany({
    where: { id, status: "queued" },
    data: { status: "running", stage: "preparing", progress: 5, startedAt: new Date(), error: null },
  });
  if (claimed.count !== 1) throw new Error("Backup job is not queued");

  let tempDirectory: string | null = null;
  let stage: BackupStage = "preparing";
  try {
    const job = await prisma.backupJob.findUniqueOrThrow({ where: { id } });
    const config = await getDecryptedBackupStorageConfig();
    if (!config?.enabled) throw new Error("Backup storage is not enabled");
    tempDirectory = await mkdtemp(join(tmpdir(), "olvm-backup-"));
    const contentsDirectory = join(tempDirectory, "contents");
    await mkdir(contentsDirectory);

    stage = "database";
    await updateStage(id, stage, 20);
    const databaseDump = join(contentsDirectory, "database.sql");
    await createDatabaseDump(databaseDump);
    const artifacts: Array<{ name: string; sha256: string }> = [
      { name: "database.sql.gz", sha256: await checksumFile(`${databaseDump}.gz`) },
    ];

    if (job.profile === "full") {
      stage = "source";
      await updateStage(id, stage, 45);
      const sourceArchive = join(contentsDirectory, "source-config.tar.gz");
      await createSourceArchive(sourceArchive);
      artifacts.push({ name: "source-config.tar.gz", sha256: await checksumFile(sourceArchive) });
    }

    const manifest = {
      formatVersion: 1,
      jobId: job.id,
      profile: job.profile,
      createdAt: new Date().toISOString(),
      database: "PostgreSQL logical dump compressed with gzip",
      artifacts,
      exclusions: [
        "OLVM virtual machines and virtual disks are excluded.",
        "OLVM ISO images and OVA files/staging are excluded.",
        "Bootstrap environment secrets (.env files and credential/key material) are excluded.",
      ],
      uploadLimitation: "The final archive uses a single PUT upload and must not exceed 1 GiB.",
    };
    await writeFile(join(contentsDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    await writeFile(join(contentsDirectory, "SHA256SUMS"), `${artifacts.map((item) => `${item.sha256}  ${item.name}`).join("\n")}\n`, { mode: 0o600 });

    stage = "packaging";
    await updateStage(id, stage, 65);
    const packagePath = join(tempDirectory, "backup.tar.gz");
    await runCommand("tar", ["-czf", packagePath, "-C", contentsDirectory, "."], commandEnvironment);
    const packageStat = await stat(packagePath);
    if (packageStat.size > MAX_ARCHIVE_BYTES) throw new BackupFailure("archive exceeds 1 GiB single-PUT limit");
    const packageChecksum = await checksumFile(packagePath);
    const body = await readFile(packagePath);
    const timestamp = new Date();
    const date = timestamp.toISOString().slice(0, 10);
    const time = timestamp.toISOString().slice(11, 19).replace(/:/g, "");
    const safeId = job.id.replace(/[^A-Za-z0-9-]/g, "");
    const key = `${config.prefix ? `${config.prefix}/` : ""}${date}/${job.profile}-${time}-${safeId}.tar.gz`;

    stage = "uploading";
    await updateStage(id, stage, 80);
    try {
      await uploadBackupObject(config, key, body, "application/gzip");
    } catch {
      throw new BackupFailure("storage upload");
    }
    stage = "verifying";
    await updateStage(id, stage, 95);
    try {
      const remote = await headBackupObject(config, key);
      if (remote.size !== packageStat.size) throw new Error("size mismatch");
    } catch {
      throw new BackupFailure("verification");
    }

    const completed = await prisma.backupJob.update({
      where: { id },
      data: {
        status: "completed", stage: "completed", progress: 100, objectKey: key,
        sizeBytes: BigInt(packageStat.size), checksum: packageChecksum, finishedAt: new Date(), error: null,
      },
    });
    await applyRetention(config, id).catch(() => undefined);
    return completed;
  } catch (error) {
    const category = error instanceof BackupFailure ? error.category : stage === "uploading" ? "storage upload" : stage === "verifying" ? "verification" : `stage ${stage}`;
    logBackupFailure(id, stage, category);
    const failed = await prisma.backupJob.update({
      where: { id },
      data: { status: "failed", stage: "failed", error: `Backup failed: ${category}`, finishedAt: new Date() },
    });
    return failed;
  } finally {
    if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
};

// Backup schedules are evaluated in UTC. scheduleWeekday is Sunday=0 through Saturday=6.
export const calculateNextRun = (config: Pick<BackupStorageConfig, "frequency" | "scheduleHour" | "scheduleWeekday">, from: Date): Date | null => {
  const base = new Date(from);
  if (!Number.isFinite(base.getTime()) || config.frequency === "manual") return null;
  if (config.frequency === "6h" || config.frequency === "12h") {
    return new Date(base.getTime() + (config.frequency === "6h" ? 6 : 12) * 60 * 60 * 1000);
  }
  if (config.frequency === "daily") {
    const next = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), config.scheduleHour));
    if (next <= base) next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }
  if (config.frequency === "weekly") {
    const next = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), config.scheduleHour));
    next.setUTCDate(next.getUTCDate() + ((config.scheduleWeekday - next.getUTCDay() + 7) % 7));
    if (next <= base) next.setUTCDate(next.getUTCDate() + 7);
    return next;
  }
  const next = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1, config.scheduleHour));
  if (next <= base) next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
};

let dueBackupRunning = false;

export const runDueBackups = async (): Promise<void> => {
  if (dueBackupRunning) return;
  dueBackupRunning = true;
  try {
    const config = await getDecryptedBackupStorageConfig();
    if (!config?.enabled || !config.scheduleEnabled || config.frequency === "manual") return;
    const now = new Date();
    if (!config.nextRunAt) {
      await prisma.backupStorageConfig.updateMany({
        where: { id: 1, nextRunAt: null },
        data: { nextRunAt: calculateNextRun(config, now) },
      });
      return;
    }
    if (config.nextRunAt > now) return;
    const nextRunAt = calculateNextRun(config, now);
    let job: BackupJob;
    try {
      job = await createBackupJob(config.defaultProfile, "scheduled", "scheduler");
    } catch {
      // Leave the due occurrence untouched while another backup owns the active-job lock.
      return;
    }
    try {
      const claimed = await prisma.backupStorageConfig.updateMany({
        where: { id: 1, scheduleEnabled: true, nextRunAt: config.nextRunAt },
        data: { lastScheduledAt: now, nextRunAt },
      });
      if (claimed.count !== 1) {
        await prisma.backupJob.deleteMany({ where: { id: job.id, status: "queued" } });
        return;
      }
    } catch {
      await prisma.backupJob.deleteMany({ where: { id: job.id, status: "queued" } }).catch(() => undefined);
      return;
    }
    await runBackupJob(job.id);
  } finally {
    dueBackupRunning = false;
  }
};

const schedulerGlobal = globalThis as typeof globalThis & { __olvmBackupSchedulerStarted?: boolean };

export const startBackupScheduler = (): void => {
  if (process.env.NODE_ENV !== "production" || schedulerGlobal.__olvmBackupSchedulerStarted) return;
  schedulerGlobal.__olvmBackupSchedulerStarted = true;
  const check = () => void runDueBackups().catch(() => undefined);
  const initial = setTimeout(check, 1_000);
  const interval = setInterval(check, 60_000);
  initial.unref();
  interval.unref();
};
