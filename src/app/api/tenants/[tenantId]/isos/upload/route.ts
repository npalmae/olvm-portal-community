import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { assertTenantAccess } from "@/lib/authz";
import {
  initIsoUploadSession,
  uploadIsoChunk,
  finalizeIsoUpload,
  type UploadSession,
} from "@/lib/isoUploadStore";

export const dynamic = "force-dynamic";
export const maxDuration = 600;
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

const sessions = new Map<string, UploadSession>();

export async function POST(req: NextRequest, ctx: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await ctx.params;
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    assertTenantAccess(session.user, tenantId, "admin");

    const chunkIndex = req.headers.get("x-chunk-index");
    const totalChunks = req.headers.get("x-total-chunks");
    const fileName = req.headers.get("x-file-name");
    const fileSize = req.headers.get("x-file-size");
    const storageDomainId = req.headers.get("x-storage-domain-id");
    const sessionId = req.headers.get("x-session-id") || "default";

    // Sin chunk headers = iniciar sesión
    if (chunkIndex === null) {
      if (!fileName || !fileSize || !storageDomainId) {
        return NextResponse.json({ error: "Faltan headers x-file-name, x-file-size, x-storage-domain-id" }, { status: 400 });
      }
      const sid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const uploadSession = await initIsoUploadSession(tenantId, decodeURIComponent(fileName), Number(fileSize), storageDomainId, sessions, sid);
      return NextResponse.json({ sessionId: sid, transferId: uploadSession.transferId });
    }

    // Recibir chunk
    const idx = Number(chunkIndex);
    const total = Number(totalChunks);
    if (!sessions.has(sessionId)) {
      return NextResponse.json({ error: "Sesión no encontrada" }, { status: 404 });
    }

    const chunkBuffer = Buffer.from(await req.arrayBuffer());
    const result = await uploadIsoChunk(sessionId, idx, total, chunkBuffer, sessions);

    if (result.done) {
      await finalizeIsoUpload(sessionId, sessions);
      sessions.delete(sessionId);
    }

    return NextResponse.json({ ok: true, chunk: idx, total, done: result.done });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
