import { NextRequest, NextResponse } from "next/server";
import { mkdir, open, rm } from "fs/promises";
import path from "path";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { auth } from "@/auth";
import { assertTenantAccess } from "@/lib/authz";

export const dynamic = "force-dynamic";
export const maxDuration = 600;
export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const CHUNK_SIZE = 50 * 1024 * 1024;
const sessions = new Map<string, { filePath: string; fileSize: number; totalChunks: number; received: Set<number> }>();

export async function POST(req: NextRequest, ctx: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await ctx.params;
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    assertTenantAccess(session.user, tenantId, "admin");

    const chunkIndex = req.headers.get("x-chunk-index");
    if (chunkIndex === null) {
      const fileName = decodeURIComponent(req.headers.get("x-file-name") ?? "");
      const fileSize = Number(req.headers.get("x-file-size") ?? 0);
      if (!fileName.toLowerCase().endsWith(".ova") || !fileSize) {
        return NextResponse.json({ error: "Selecciona un archivo .ova válido" }, { status: 400 });
      }
      const id = crypto.randomUUID();
      const dir = path.join(process.cwd(), "data", "ova-staging");
      await mkdir(dir, { recursive: true });
      const filePath = path.join(dir, `${id}.ova`);
      await open(filePath, "w").then((file) => file.close());
      sessions.set(id, { filePath, fileSize, totalChunks: Math.ceil(fileSize / CHUNK_SIZE), received: new Set() });
      return NextResponse.json({ sessionId: id });
    }

    const id = req.headers.get("x-session-id") ?? "";
    const upload = sessions.get(id);
    const index = Number(chunkIndex);
    if (!upload || !Number.isInteger(index) || index < 0 || index >= upload.totalChunks) {
      return NextResponse.json({ error: "Sesión de subida inválida o expirada" }, { status: 404 });
    }
    const buffer = Buffer.from(await req.arrayBuffer());
    const file = await open(upload.filePath, "r+");
    await file.write(buffer, 0, buffer.length, index * CHUNK_SIZE);
    await file.close();
    upload.received.add(index);
    const done = upload.received.size === upload.totalChunks;
    if (!done) return NextResponse.json({ ok: true, chunk: index, done: false });

    try {
      const { stdout } = await execFileAsync("tar", ["-tf", upload.filePath], { maxBuffer: 1024 * 1024 });
      const ovf = stdout.split("\n").find((entry) => entry.toLowerCase().endsWith(".ovf"));
      if (!ovf) throw new Error("El OVA no contiene un archivo OVF");
      sessions.delete(id);
      return NextResponse.json({ ok: true, done: true, uploadId: id, ovf });
    } catch (error) {
      await rm(upload.filePath, { force: true });
      sessions.delete(id);
      throw new Error(`OVA inválido: ${(error as Error).message}`);
    }
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
