import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { assertTenantAccess } from "@/lib/authz";
import { resolveTenant } from "@/lib/config";
import { Agent as UndiciAgent, fetch as undiciFetch } from "undici";

export const dynamic = "force-dynamic";
export const maxDuration = 600;
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

const CHUNK_SIZE = 50 * 1024 * 1024;

// Sesiones en memoria del proceso
const sessions = new Map<string, {
  tenant: Awaited<ReturnType<typeof resolveTenant>>;
  diskId: string;
  transferId: string;
  uploadUrl: string;
  fileSize: number;
  receivedChunks: number;
  totalChunks: number;
  dispatcher: UndiciAgent;
}>();

const olvmRaw = async (tenant: Awaited<ReturnType<typeof resolveTenant>>, path: string, options?: RequestInit) => {
  const url = `${tenant.baseUrl}${path}`;
  const auth = tenant.token
    ? `Bearer ${tenant.token}`
    : `Basic ${Buffer.from(`${tenant.username}:${tenant.password}`).toString("base64")}`;
  const res = await undiciFetch(url, {
    ...options,
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: auth, ...(options?.headers as Record<string, string>) },
    dispatcher: new UndiciAgent({ connect: { rejectUnauthorized: false } }) as unknown as never,
  } as any);
  const text = await res.text();
  if (!res.ok) throw new Error(`OLVM ${res.status}: ${text.slice(0, 300)}`);
  return text;
};

export async function POST(req: NextRequest, ctx: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await ctx.params;
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    assertTenantAccess(session.user, tenantId, "admin");

    const chunkIndex = req.headers.get("x-chunk-index");
    const fileName = req.headers.get("x-file-name");
    const fileSize = req.headers.get("x-file-size");
    const storageDomainId = req.headers.get("x-storage-domain-id");
    const sessionId = req.headers.get("x-session-id") || "";

    // === INIT: sin x-chunk-index ===
    if (chunkIndex === null) {
      if (!fileName || !fileSize || !storageDomainId)
        return NextResponse.json({ error: "Faltan headers" }, { status: 400 });

      const tenant = await resolveTenant(tenantId);
      const name = decodeURIComponent(fileName);
      const size = Number(fileSize);

      // 0. Verificar si ya existe una ISO con ese nombre
      const existing = await olvmRaw(tenant, "/disks?search=name%3D" + encodeURIComponent(name));
      let existingId = "";
      try {
        const ej = JSON.parse(existing);
        const disks = ej.disk ?? [];
        const match = disks.find((d: { content_type?: string }) => d.content_type === "iso");
        existingId = match?.id ?? "";
      } catch { /* ignore */ }
      if (existingId) throw new Error(`Ya existe una ISO llamada "${name}"`);

      // 1. Crear disco
      const diskRes = await olvmRaw(tenant, "/disks", {
        method: "POST",
        body: JSON.stringify({
          name, alias: name, content_type: "iso", format: "raw", sparse: false,
          provisioned_size: size,
          storage_domains: { storage_domain: [{ id: storageDomainId }] },
        }),
      });
      let diskId = "";
      try { diskId = JSON.parse(diskRes).id ?? ""; } catch {
        diskId = diskRes.match(/<disk[^>]*id="([^"]+)"/)?.[1] ?? "";
      }
      if (!diskId) throw new Error("No se pudo crear el disco ISO");

      // 2. Esperar disco ok
      for (let i = 0; i < 30; i++) {
        const d = await olvmRaw(tenant, `/disks/${diskId}`);
        try { if (JSON.parse(d).status === "ok") break; } catch { if (d.includes(">ok<")) break; }
        await new Promise((r) => setTimeout(r, 2000));
      }

      // 3. Crear image transfer
      const tRes = await olvmRaw(tenant, "/imagetransfers", {
        method: "POST",
        body: JSON.stringify({ disk: { id: diskId }, direction: "upload" }),
      });
      let transferId = "";
      let proxyUrl = "";
      try {
        const tj = JSON.parse(tRes);
        transferId = tj.id ?? "";
        proxyUrl = tj.proxy_url ?? tj.transfer_url ?? "";
      } catch {
        transferId = tRes.match(/id="([^"]+)"/)?.[1] ?? "";
        proxyUrl = tRes.match(/<proxy_url>([^<]+)<\/proxy_url>/)?.[1]
          ?? tRes.match(/<transfer_url>([^<]+)<\/transfer_url>/)?.[1] ?? "";
      }
      if (!transferId || !proxyUrl) throw new Error("No se pudo iniciar transferencia");

      // 4. Esperar phase=transferring
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const t = await olvmRaw(tenant, `/imagetransfers/${transferId}`);
        let phase = "";
        try { phase = JSON.parse(t).phase ?? ""; } catch { phase = t.match(/<phase>([^<]+)<\/phase>/)?.[1]?.trim() ?? ""; }
        if (phase === "transferring") break;
        if (phase.includes("failure") || phase.includes("error")) throw new Error("Transfer fallida");
      }

      // 5. Reemplazar hostname por IP del engine
      const engineHost = new URL(tenant.baseUrl).hostname;
      let uploadUrl = proxyUrl;
      try {
        const proxyHost = new URL(proxyUrl).hostname;
        if (proxyHost !== engineHost) uploadUrl = proxyUrl.replace(proxyHost, engineHost);
      } catch { /* keep */ }

      const sid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      sessions.set(sid, {
        tenant, diskId, transferId, uploadUrl, fileSize: size,
        receivedChunks: 0,
        totalChunks: Math.ceil(size / CHUNK_SIZE),
        dispatcher: new UndiciAgent({ connect: { rejectUnauthorized: false }, bodyTimeout: 0, headersTimeout: 0 }),
      });

      return NextResponse.json({ sessionId: sid });
    }

    // === CHUNK ===
    const idx = Number(chunkIndex);
    const s = sessions.get(sessionId);
    if (!s) return NextResponse.json({ error: "Sesión expirada" }, { status: 404 });

    const buf = Buffer.from(await req.arrayBuffer());
    const start = idx * CHUNK_SIZE;

    const upRes = await undiciFetch(s.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(buf.length),
        "Content-Range": `bytes ${start}-${start + buf.length - 1}/${s.fileSize}`,
      },
      body: buf,
      dispatcher: s.dispatcher as unknown as never,
      duplex: "half",
    } as any);

    if (!upRes.ok) {
      const d = await upRes.text().catch(() => "");
      throw new Error(`Chunk ${idx} (${upRes.status}): ${d.slice(0, 200)}`);
    }

    s.receivedChunks++;
    const done = s.receivedChunks >= s.totalChunks;

    if (done) {
      await olvmRaw(s.tenant, `/imagetransfers/${s.transferId}/finalize`, { method: "POST", body: "{}" });
      sessions.delete(sessionId);
    }

    return NextResponse.json({ ok: true, chunk: idx, done });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
