import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { recoverStaleBackupJobs, runDueBackups } from "@/lib/backupService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const safeEqual = (left: string, right: string) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

let recovered = false;

export async function POST(request: Request) {
  const expected = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "";
  const provided = request.headers.get("x-internal-secret") ?? "";
  if (!expected || !safeEqual(provided, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!recovered) {
    await recoverStaleBackupJobs();
    recovered = true;
  }
  await runDueBackups();
  return NextResponse.json({ ok: true });
}
