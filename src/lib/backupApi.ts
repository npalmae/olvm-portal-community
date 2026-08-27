import type { Session } from "next-auth";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isPlatformSuperadmin } from "@/lib/authz";

type BackupApiAuthorization =
  | { user: Session["user"]; response: null }
  | { user: null; response: NextResponse };

export const requireBackupSuperadmin = async (): Promise<BackupApiAuthorization> => {
  const session = await auth();
  if (!session?.user) {
    return { user: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!isPlatformSuperadmin(session.user)) {
    return { user: null, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user: session.user, response: null };
};

const SAFE_VALIDATION_MESSAGES = new Set([
  "Backup provider must be s3",
  "Backup endpoint must be a valid HTTPS URL",
  "Backup endpoint must use HTTPS",
  "Backup endpoint must not contain credentials",
  "Backup endpoint must not contain a query or fragment",
  "Backup endpoint must not contain a path",
  "Backup endpoint host is not allowed",
  "Backup region is invalid",
  "Backup bucket is invalid",
  "Backup prefix is invalid",
  "Backup access key is required",
  "Backup secret key is required",
  "Backup frequency is invalid",
  "Backup profile is invalid",
  "Backup credentials are required",
]);
const SAFE_RANGE_MESSAGE = /^(?:Schedule hour|Schedule weekday|Retention days|Retention count) must be an integer from \d+ to \d+$/;

export const safeBackupValidationMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : "";
  return SAFE_VALIDATION_MESSAGES.has(message) || SAFE_RANGE_MESSAGE.test(message)
    ? message
    : "Invalid backup storage configuration";
};
