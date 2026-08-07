import { NextResponse } from "next/server";
import { requireBackupSuperadmin } from "@/lib/backupApi";
import { createBackupJob, listBackupJobs, runBackupJob, serializeBackupJob } from "@/lib/backupService";
import { getDecryptedBackupStorageConfig, type BackupProfile } from "@/lib/backupStorage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const authorization = await requireBackupSuperadmin();
  if (authorization.response) return authorization.response;
  const rawLimit = new URL(request.url).searchParams.get("limit");
  const limit = rawLimit === null ? 100 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    return NextResponse.json({ error: "limit must be an integer from 1 to 500" }, { status: 400 });
  }
  try {
    const jobs = await listBackupJobs(limit);
    return NextResponse.json(jobs.map(serializeBackupJob));
  } catch {
    return NextResponse.json({ error: "Unable to list backups" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const authorization = await requireBackupSuperadmin();
  if (authorization.response) return authorization.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 });
  }
  const profile = (body as Record<string, unknown>).profile;
  if (profile !== "operational" && profile !== "full") {
    return NextResponse.json({ error: "Backup profile must be operational or full" }, { status: 400 });
  }

  try {
    const config = await getDecryptedBackupStorageConfig();
    if (!config?.enabled) {
      return NextResponse.json({ error: "Backup storage is not configured and enabled" }, { status: 409 });
    }
    const requestedBy = authorization.user.email || authorization.user.id;
    const job = await createBackupJob(profile as BackupProfile, "manual", requestedBy);
    void runBackupJob(job.id).catch(() => undefined);
    return NextResponse.json(serializeBackupJob(job), { status: 202 });
  } catch (error) {
    if (error instanceof Error && error.message === "A backup is already queued or running") {
      return NextResponse.json({ error: "A backup is already queued or running" }, { status: 409 });
    }
    return NextResponse.json({ error: "Unable to create backup" }, { status: 500 });
  }
}
