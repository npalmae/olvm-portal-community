import { NextResponse } from "next/server";
import { requireBackupSuperadmin } from "@/lib/backupApi";
import { getDecryptedBackupStorageConfig, testBackupStorage } from "@/lib/backupStorage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const authorization = await requireBackupSuperadmin();
  if (authorization.response) return authorization.response;
  try {
    const config = await getDecryptedBackupStorageConfig();
    if (!config) {
      return NextResponse.json({ error: "Backup storage is not configured" }, { status: 400 });
    }
    await testBackupStorage(config);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Backup storage test failed" }, { status: 502 });
  }
}
