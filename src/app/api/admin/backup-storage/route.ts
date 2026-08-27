import { NextResponse } from "next/server";
import { requireBackupSuperadmin, safeBackupValidationMessage } from "@/lib/backupApi";
import { calculateNextRun } from "@/lib/backupService";
import {
  getDecryptedBackupStorageConfig,
  getPublicBackupStorageConfig,
  saveBackupStorageConfig,
  type BackupStorageConfigInput,
} from "@/lib/backupStorage";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const INPUT_FIELDS = new Set([
  "provider", "endpoint", "region", "bucket", "prefix", "accessKey", "secretKey",
  "forcePathStyle", "enabled", "scheduleEnabled", "frequency", "scheduleHour",
  "scheduleWeekday", "retentionDays", "retentionCount", "defaultProfile",
]);
const STRING_FIELDS = ["endpoint", "region", "bucket", "prefix", "accessKey", "secretKey"] as const;
const BOOLEAN_FIELDS = ["forcePathStyle", "enabled", "scheduleEnabled"] as const;
const NUMBER_FIELDS = ["scheduleHour", "scheduleWeekday", "retentionDays", "retentionCount"] as const;

const parseInput = (value: unknown): BackupStorageConfigInput => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Request body must be a JSON object");
  const body = value as Record<string, unknown>;
  if ("lastScheduledAt" in body || "nextRunAt" in body) throw new Error("Scheduling timestamps are server-managed");
  if (Object.keys(body).some((key) => !INPUT_FIELDS.has(key))) throw new Error("Request body contains an unsupported field");
  for (const field of STRING_FIELDS) {
    if (body[field] !== undefined && typeof body[field] !== "string") throw new Error(`${field} must be a string`);
  }
  for (const field of BOOLEAN_FIELDS) {
    if (body[field] !== undefined && typeof body[field] !== "boolean") throw new Error(`${field} must be a boolean`);
  }
  for (const field of NUMBER_FIELDS) {
    if (body[field] !== undefined && typeof body[field] !== "number") throw new Error(`${field} must be a number`);
  }
  if (body.provider !== undefined && body.provider !== "s3") throw new Error("Backup provider must be s3");
  if (body.frequency !== undefined && !["manual", "6h", "12h", "daily", "weekly", "monthly"].includes(body.frequency as string)) {
    throw new Error("Backup frequency is invalid");
  }
  if (body.defaultProfile !== undefined && body.defaultProfile !== "operational" && body.defaultProfile !== "full") {
    throw new Error("Backup profile is invalid");
  }
  return body as BackupStorageConfigInput;
};

export async function GET() {
  const authorization = await requireBackupSuperadmin();
  if (authorization.response) return authorization.response;
  try {
    return NextResponse.json(await getPublicBackupStorageConfig());
  } catch {
    return NextResponse.json({ error: "Unable to read backup storage configuration" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const authorization = await requireBackupSuperadmin();
  if (authorization.response) return authorization.response;

  let input: BackupStorageConfigInput;
  try {
    input = parseInput(await request.json());
  } catch (error) {
    return NextResponse.json({ error: safeBackupValidationMessage(error) }, { status: 400 });
  }

  try {
    const existing = await getDecryptedBackupStorageConfig();
    const enabled = input.enabled ?? existing?.enabled ?? true;
    const scheduleEnabled = input.scheduleEnabled ?? existing?.scheduleEnabled ?? false;
    const schedule = {
      frequency: input.frequency ?? existing?.frequency ?? "daily",
      scheduleHour: input.scheduleHour ?? existing?.scheduleHour ?? 2,
      scheduleWeekday: input.scheduleWeekday ?? existing?.scheduleWeekday ?? 0,
    };
    input.nextRunAt = enabled && scheduleEnabled && schedule.frequency !== "manual"
      ? calculateNextRun(schedule, new Date())
      : null;
    return NextResponse.json(await saveBackupStorageConfig(input));
  } catch (error) {
    const message = safeBackupValidationMessage(error);
    if (message !== "Invalid backup storage configuration") {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: "Unable to save backup storage configuration" }, { status: 500 });
  }
}

export async function DELETE() {
  const authorization = await requireBackupSuperadmin();
  if (authorization.response) return authorization.response;
  try {
    const active = await prisma.backupJob.findFirst({
      where: { status: { in: ["queued", "running"] } },
      select: { id: true },
    });
    if (active) return NextResponse.json({ error: "A backup is queued or running" }, { status: 409 });
    await prisma.backupStorageConfig.deleteMany({ where: { id: 1 } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Unable to delete backup storage configuration" }, { status: 500 });
  }
}
